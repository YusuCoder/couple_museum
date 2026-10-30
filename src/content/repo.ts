import * as local from './db'
import { blobKey, normalizeMuseum, type StoredMoment, type StoredMuseum, type StoredRoom } from './db'
import { MEDIA_BUCKET, supabase } from './supabase'

/**
 * Where a museum lives. The builder and the 3D museum only talk to this, so
 * "this device" (IndexedDB) and "our account" (Supabase) behave the same.
 * Blob keys come from `blobKey` (media:<id>, voice:<id>, music).
 */
export interface Repo {
  kind: 'local' | 'cloud'
  /** Museum metadata plus a playable URL per stored blob key. */
  load(): Promise<{ museum: StoredMuseum; urls: Record<string, string> }>
  /** Writes metadata. Never deletes moments — see removeMoment — so two editors can't erase each other's additions. */
  save(museum: StoredMuseum): Promise<void>
  removeMoment(id: string): Promise<void>
  /** Called after the room's moments have been moved elsewhere. */
  removeRoom(id: string): Promise<void>
  /** Stores the blob and returns a URL the page can use right away. */
  putBlob(key: string, blob: Blob): Promise<string>
  getBlob(key: string): Promise<Blob | null>
  deleteBlob(key: string): Promise<void>
}

function keysOf(m: StoredMuseum) {
  return [
    ...m.moments.flatMap((x) => [blobKey.media(x.id), ...(x.voice ? [blobKey.voice(x.id)] : [])]),
    ...(m.music ? [blobKey.music] : []),
  ]
}

export const localRepo: Repo = {
  kind: 'local',
  async load() {
    const museum = (await local.loadMuseum().catch(() => null)) ?? local.emptyMuseum()
    const urls: Record<string, string> = {}
    for (const k of keysOf(museum)) {
      const b = await local.getBlob(k).catch(() => null)
      if (b) urls[k] = URL.createObjectURL(b)
    }
    return { museum, urls }
  },
  save: local.saveMuseum,
  // Local saves write the whole museum, so the moment / room is already gone
  async removeMoment() {},
  async removeRoom() {},
  async putBlob(key, blob) {
    await local.putBlob(key, blob)
    return URL.createObjectURL(blob)
  },
  getBlob: local.getBlob,
  deleteBlob: local.deleteBlob,
}

// ---------------------------------------------------------------- cloud

const SIGNED_URL_TTL = 60 * 60 * 12

/** "media:abc" → "<museum>/media-abc" */
const pathOf = (museumId: string, key: string) => `${museumId}/${key.replace(':', '-')}`

interface MomentRow {
  id: string
  room_id: string | null
  position: number
  kind: 'photo' | 'video'
  title: string
  date: string
  caption: string
  aspect: number
  voice_name: string | null
}

export function cloudRepo(museumId: string): Repo {
  const db = supabase!
  const bucket = () => db.storage.from(MEDIA_BUCKET)

  const signed = async (key: string) => {
    const { data, error } = await bucket().createSignedUrl(pathOf(museumId, key), SIGNED_URL_TTL)
    if (error) throw error
    return data.signedUrl
  }

  return {
    kind: 'cloud',

    async load() {
      const [{ data: row, error: e1 }, { data: rows, error: e2 }, { data: roomRows, error: e4 }] = await Promise.all([
        db.from('museums').select('names, since, music_name').eq('id', museumId).single(),
        db
          .from('moments')
          .select('id, room_id, position, kind, title, date, caption, aspect, voice_name')
          .eq('museum_id', museumId)
          .order('position'),
        db.from('museum_rooms').select('id, shape, title, subtitle').eq('museum_id', museumId).order('position'),
      ])
      if (e1) throw e1
      if (e2) throw e2
      if (e4) throw e4

      const museum: StoredMuseum = normalizeMuseum({
        names: row.names,
        since: row.since,
        music: row.music_name ? { name: row.music_name } : undefined,
        rooms: roomRows as StoredRoom[],
        moments: (rows as MomentRow[]).map((r) => ({
          id: r.id,
          roomId: r.room_id ?? '',
          kind: r.kind,
          title: r.title,
          date: r.date,
          caption: r.caption,
          aspect: r.aspect,
          voice: r.voice_name ? { name: r.voice_name } : undefined,
        })),
      })

      const keys = keysOf(museum)
      const urls: Record<string, string> = {}
      if (keys.length) {
        const { data, error } = await bucket().createSignedUrls(
          keys.map((k) => pathOf(museumId, k)),
          SIGNED_URL_TTL,
        )
        if (error) throw error
        data.forEach((d, i) => {
          if (d.signedUrl) urls[keys[i]] = d.signedUrl
        })
      }
      return { museum, urls }
    },

    async save(museum) {
      const { error: e1 } = await db
        .from('museums')
        .update({
          names: museum.names,
          since: museum.since,
          music_name: museum.music?.name ?? null,
          music_path: museum.music ? pathOf(museumId, blobKey.music) : null,
        })
        .eq('id', museumId)
      if (e1) throw e1

      // Rooms first: moments reference them
      const { error: e5 } = await db.from('museum_rooms').upsert(
        museum.rooms.map((r, position) => ({
          id: r.id,
          museum_id: museumId,
          position,
          shape: r.shape ?? 'hall',
          title: r.title,
          subtitle: r.subtitle,
        })),
      )
      if (e5) throw e5

      const rows = museum.moments.map((m: StoredMoment, position) => ({
        id: m.id,
        museum_id: museumId,
        room_id: m.roomId,
        position,
        kind: m.kind,
        title: m.title,
        date: m.date,
        caption: m.caption,
        aspect: m.aspect,
        media_path: pathOf(museumId, blobKey.media(m.id)),
        voice_path: m.voice ? pathOf(museumId, blobKey.voice(m.id)) : null,
        voice_name: m.voice?.name ?? null,
      }))
      if (rows.length) {
        const { error } = await db.from('moments').upsert(rows)
        if (error) throw error
      }
    },

    async removeMoment(id) {
      const { error } = await db.from('moments').delete().eq('id', id).eq('museum_id', museumId)
      if (error) throw error
    },

    async removeRoom(id) {
      const { error } = await db.from('museum_rooms').delete().eq('id', id).eq('museum_id', museumId)
      if (error) throw error
    },

    async putBlob(key, blob) {
      const { error } = await bucket().upload(pathOf(museumId, key), blob, {
        upsert: true,
        contentType: blob.type || undefined,
      })
      if (error) {
        throw new Error(
          /exceeded|too large|413/i.test(error.message)
            ? 'That file is larger than your Supabase upload limit. Try a shorter or compressed video.'
            : `Upload failed: ${error.message}`,
        )
      }
      return signed(key)
    },

    async getBlob(key) {
      const { data } = await bucket().download(pathOf(museumId, key))
      return data
    },

    async deleteBlob(key) {
      await bucket().remove([pathOf(museumId, key)])
    },
  }
}

// ---------------------------------------------------------------- account

/** The museum to show right now: the account's when signed in, else this device's. */
export async function currentRepo(): Promise<Repo> {
  if (!supabase) return localRepo
  const { data } = await supabase.auth.getSession()
  if (!data.session) return localRepo
  return cloudRepo((await resolveCloudMuseum()).id)
}

export interface CloudMuseum {
  id: string
  inviteCode: string
  /** For the no-account visit link / QR code (missing until the visit-links migration is applied). */
  visitCode?: string
  /** The couple: owner and partner (visitors from the visit link aren't counted). */
  members: number
  /** The invite link couldn't be used (expired, museum full…): shown to the user, who carries on in their own museum. */
  joinProblem?: string
}

/**
 * The signed-in user's museum: joins via invite code when given, otherwise the
 * most recently joined museum, otherwise a fresh one.
 */
/**
 * One lookup at a time: the first sign-in creates the museum, and two
 * overlapping calls (React runs effects twice in development; auth events can
 * double up) would otherwise each create one.
 */
let resolving: { key: string; promise: Promise<CloudMuseum> } | null = null
export function resolveCloudMuseum(joinCode?: string | null): Promise<CloudMuseum> {
  const key = joinCode ?? ''
  if (resolving?.key === key) return resolving.promise
  const promise = findOrCreateMuseum(joinCode).finally(() => {
    if (resolving?.promise === promise) resolving = null
  })
  resolving = { key, promise }
  return promise
}

async function findOrCreateMuseum(joinCode?: string | null): Promise<CloudMuseum> {
  const db = supabase!
  let joinProblem: string | undefined
  if (joinCode) {
    const { error } = await db.rpc('join_museum', { code: joinCode })
    if (error) joinProblem = error.message
  }

  const { data: user } = await db.auth.getUser()
  const uid = user.user?.id
  if (!uid) throw new Error('Not signed in')
  const visitor = user.user?.is_anonymous ?? false

  const { data: mine, error } = await db
    .from('museum_members')
    .select('museum_id')
    .eq('user_id', uid)
    .order('joined_at', { ascending: false })
    .limit(1)
  if (error) throw error

  let museumId = mine[0]?.museum_id as string | undefined
  // A visitor (no account) only ever sees museums opened from a visit link
  if (!museumId && visitor) throw new Error('Open the museum link again')
  if (!museumId) {
    const { data, error: e2 } = await db.from('museums').insert({ owner_id: uid }).select('id').single()
    if (e2?.code === '23505') {
      // Another tab got there first (one museum per owner): use that one
      const { data: own, error: e4 } = await db.from('museums').select('id').eq('owner_id', uid).single()
      if (e4) throw e4
      museumId = own.id as string
    } else if (e2) throw e2
    else museumId = data.id as string
  }

  const [{ data: m, error: e3 }, { count }] = await Promise.all([
    // '*': works before and after the visit-links migration (visit_code)
    db.from('museums').select('*').eq('id', museumId).single(),
    db
      .from('museum_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('museum_id', museumId)
      .in('role', ['owner', 'partner']),
  ])
  if (e3) throw e3
  return {
    id: museumId,
    inviteCode: m.invite_code as string,
    visitCode: (m.visit_code as string | undefined) ?? undefined,
    members: count ?? 1,
    joinProblem,
  }
}
