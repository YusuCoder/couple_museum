import * as THREE from 'three'
import type { RealtimeChannel } from '@supabase/supabase-js'

import { supabase } from '../content/supabase'
import type { Seat } from './Seats'

/**
 * Walking the museum together: each visitor drives their own figure and
 * sends where it is a few times a second; everyone else's figure follows those
 * reports, drawn a moment in the past so it can be smoothed between them.
 *
 * Online, the reports go over the museum's private Supabase Realtime channel
 * (members only). Without an account (this device / demo), tabs of the same
 * browser talk over a BroadcastChannel — handy for trying it out.
 */

export type Who = 'him' | 'her'

export interface Pose {
  id: string
  who: Who
  x: number
  y: number
  z: number
  vx: number
  vz: number
  /** Facing actually shown (radians, forward = (sin, cos)). */
  yaw: number
  seat: Seat | null
  /** Sender's clock (ms), so stale or reordered reports can be dropped. */
  t: number
}

export interface Remote {
  who: Who
  /** Recent reports, oldest first, stamped with when they arrived here. */
  snaps: { pose: Pose; at: number }[]
  seen: number
}

/** Everyone else in the museum right now, by id. */
export const remotes = new Map<string, Remote>()

/** How far in the past remote figures are drawn (ms): room to smooth between reports. */
const DELAY = 160
/** Gone quiet for this long (ms): they've left. */
const TIMEOUT = 6000

export interface Link {
  send: (pose: Pose) => void
  close: () => void
}

export type LinkStatus = { state: 'connecting' | 'live' | 'device' | 'failed'; why?: string }

/** Join the museum's channel. `onChange` fires when someone arrives or leaves; `onStatus` as the connection changes. */
export function connect(museumId: string | null, onChange: () => void, onStatus: (s: LinkStatus) => void): Link {
  const receive = (pose: Pose) => {
    let r = remotes.get(pose.id)
    if (!r) {
      r = { who: pose.who, snaps: [], seen: 0 }
      remotes.set(pose.id, r)
      onChange()
    }
    const last = r.snaps[r.snaps.length - 1]
    if (last && pose.t <= last.pose.t) return
    r.who = pose.who
    r.seen = performance.now()
    r.snaps.push({ pose, at: r.seen })
    if (r.snaps.length > 30) r.snaps.shift()
  }
  const drop = (id: string) => {
    if (remotes.delete(id)) onChange()
  }

  if (museumId && supabase) {
    const db = supabase
    let live = false
    const channel: RealtimeChannel = db.channel(`museum:${museumId}`, {
      config: { private: true, broadcast: { self: false } },
    })
    channel
      .on('broadcast', { event: 'pose' }, ({ payload }) => receive(payload as Pose))
      .on('broadcast', { event: 'bye' }, ({ payload }) => drop((payload as { id: string }).id))
      .subscribe((status, err) => {
        live = status === 'SUBSCRIBED'
        if (live) onStatus({ state: 'live' })
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          const why = err?.message ?? status
          console.warn('Walking together is unavailable:', why)
          onStatus({ state: 'failed', why })
        }
      })
    let me: string | null = null
    return {
      send: (pose) => {
        me = pose.id
        if (live) void channel.send({ type: 'broadcast', event: 'pose', payload: pose })
      },
      close: () => {
        if (live && me) void channel.send({ type: 'broadcast', event: 'bye', payload: { id: me } })
        void db.removeChannel(channel)
        remotes.clear()
      },
    }
  }

  onStatus({ state: 'device' })
  if (typeof BroadcastChannel === 'undefined') return { send: () => {}, close: () => {} }
  const bc = new BroadcastChannel('couple-museum-together')
  bc.onmessage = (e: MessageEvent<{ type: 'pose'; pose: Pose } | { type: 'bye'; id: string }>) => {
    if (e.data.type === 'pose') receive(e.data.pose)
    else drop(e.data.id)
  }
  let me: string | null = null
  const bye = () => me && bc.postMessage({ type: 'bye', id: me })
  addEventListener('pagehide', bye)
  return {
    send: (pose) => {
      me = pose.id
      bc.postMessage({ type: 'pose', pose })
    },
    close: () => {
      bye()
      removeEventListener('pagehide', bye)
      bc.close()
      remotes.clear()
    },
  }
}

/** Forget anyone who has gone quiet. Returns true if someone was dropped. */
export function pruneRemotes() {
  const now = performance.now()
  let changed = false
  for (const [id, r] of remotes) {
    if (now - r.seen > TIMEOUT) {
      remotes.delete(id)
      changed = true
    }
  }
  return changed
}

const _a = new THREE.Vector3()

/**
 * Where a remote figure is "now" (DELAY ms ago), blended between the two
 * reports either side; past the newest report, it carries on briefly at its
 * last speed. Writes position and velocity; returns the newest report.
 */
export function sample(r: Remote, position: THREE.Vector3, velocity: THREE.Vector3): Pose | null {
  const snaps = r.snaps
  if (!snaps.length) return null
  const t = performance.now() - DELAY
  const newest = snaps[snaps.length - 1]
  let i = snaps.length - 1
  while (i > 0 && snaps[i - 1].at > t) i--
  const b = snaps[i]
  const a = snaps[i - 1]
  if (a && t >= a.at && t <= b.at && b.at > a.at) {
    const k = (t - a.at) / (b.at - a.at)
    position.set(a.pose.x, a.pose.y, a.pose.z).lerp(_a.set(b.pose.x, b.pose.y, b.pose.z), k)
    velocity.set(THREE.MathUtils.lerp(a.pose.vx, b.pose.vx, k), 0, THREE.MathUtils.lerp(a.pose.vz, b.pose.vz, k))
  } else {
    // Ahead of the reports (or only one so far): from the newest, moving on at its speed for a little while
    const p = newest.pose
    const ahead = Math.min(Math.max(t - newest.at, 0), 250) / 1000
    position.set(p.x + p.vx * ahead, p.y, p.z + p.vz * ahead)
    velocity.set(p.vx, 0, p.vz)
  }
  return newest.pose
}

/** The first person here who is the other half of the couple (for the embrace). */
export function partnerOf(me: Who): [string, Remote] | null {
  for (const entry of remotes) if (entry[1].who !== me) return entry
  return null
}
