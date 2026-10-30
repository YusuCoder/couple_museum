import type { RoomShape } from '../museum/floorplan'

/**
 * Local-first storage for the couple's museum: one metadata record plus media
 * blobs, all in IndexedDB on this device. Swap this module for Supabase later
 * (same function shapes) when museums become shareable.
 */

export interface StoredMoment {
  id: string
  /** The room (chapter) this moment hangs in. */
  roomId: string
  kind: 'photo' | 'video'
  title: string
  date: string
  caption: string
  /** Width / height of the photo or video. */
  aspect: number
  /** Stored size and the original upload's size (shown as "48 MB → 0.8 MB"). */
  bytes?: number
  originalBytes?: number
  /** Optional voice note attached to a photo. */
  voice?: { name: string }
}

/** A chapter of the story — one room of the building, e.g. "How we met". */
export interface StoredRoom {
  id: string
  /** Room type; rooms saved before shapes existed are halls. */
  shape?: RoomShape
  title: string
  /** Shown under the title, e.g. "2019 – 2021". */
  subtitle: string
}

export interface StoredMuseum {
  names: string
  since: string
  /** In walking order: the first room is behind the front door. */
  rooms: StoredRoom[]
  /** Flat list; a room's moments are the ones with its roomId, in this order. */
  moments: StoredMoment[]
  /** Background soundtrack; generated ambient music when absent. */
  music?: { name: string }
}

export const newRoom = (title = '', subtitle = '', shape: RoomShape = 'hall'): StoredRoom => ({
  id: crypto.randomUUID(),
  shape,
  title,
  subtitle,
})

export function emptyMuseum(): StoredMuseum {
  return { names: '', since: '', rooms: [newRoom('How we met')], moments: [] }
}

/** Museums saved before rooms existed: put everything into one room. Also repairs moments whose room was deleted. */
export function normalizeMuseum(m: StoredMuseum): StoredMuseum {
  const rooms = m.rooms?.length ? m.rooms : [{ ...newRoom('Our story') }]
  const ids = new Set(rooms.map((r) => r.id))
  const moments = (m.moments ?? []).map((x) => (x.roomId && ids.has(x.roomId) ? x : { ...x, roomId: rooms[0].id }))
  return { ...m, rooms, moments }
}

/** Blob keys: one per moment's media, its voice note, and the soundtrack. */
export const blobKey = {
  media: (id: string) => `media:${id}`,
  voice: (id: string) => `voice:${id}`,
  music: 'music',
}

const DB_NAME = 'couple-museum'
const META_KEY = 'museum'

let dbPromise: Promise<IDBDatabase> | null = null

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('meta')
      req.result.createObjectStore('blobs')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function run<T>(store: 'meta' | 'blobs', mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>) {
  const d = await db()
  return new Promise<T>((resolve, reject) => {
    const tx = d.transaction(store, mode)
    const req = op(tx.objectStore(store))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function loadMuseum(): Promise<StoredMuseum | null> {
  const m = (await run('meta', 'readonly', (s) => s.get(META_KEY))) as StoredMuseum | undefined
  return m ? normalizeMuseum(m) : null
}

export async function saveMuseum(museum: StoredMuseum) {
  await run('meta', 'readwrite', (s) => s.put(museum, META_KEY))
}

export async function putBlob(key: string, blob: Blob) {
  await run('blobs', 'readwrite', (s) => s.put(blob, key))
  // Ask the browser not to evict the couple's memories under storage pressure
  void navigator.storage?.persist?.()
}

export async function getBlob(key: string): Promise<Blob | null> {
  return ((await run('blobs', 'readonly', (s) => s.get(key))) as Blob | undefined) ?? null
}

export async function deleteBlob(key: string) {
  await run('blobs', 'readwrite', (s) => s.delete(key))
}
