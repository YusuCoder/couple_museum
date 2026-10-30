import { useEffect } from 'react'

import { onWorld, type WorldEvent } from './presence'
import { useMuseum } from './store'

/**
 * The parts of the museum both visitors share, kept the same on every screen:
 * - the front door and the doors between rooms (opened or swung shut by either),
 * - films, which play in step: each film runs on a shared clock started at its
 *   `epoch` (ms since 1970; 0 = the film has been looping since then), and
 *   "Replay" restarts it for everyone,
 * - voice notes: one visitor setting one off sets it off for the other too.
 */

/** Film id → when it (re)started, ms on the wall clock (phones' clocks agree to well under a second). */
export const filmEpochs = new Map<string, number>()

/** Where a film should be right now (seconds), on the shared clock. */
export function filmTime(id: string, duration: number) {
  if (!(duration > 0) || !Number.isFinite(duration)) return 0
  return (((Date.now() - (filmEpochs.get(id) ?? 0)) / 1000) % duration + duration) % duration
}

/** Voice notes listening for the other visitor setting them off, by exhibit id. */
export const voiceTriggers = new Map<string, () => void>()

export function worldSnapshot(): WorldEvent {
  const s = useMuseum.getState()
  return {
    kind: 'snapshot',
    gate: s.gate !== 'closed',
    doors: Object.entries(s.doors)
      .filter(([, d]) => d.state === 'open' || d.state === 'opening')
      .map(([index, d]) => ({ index: Number(index), dir: d.dir })),
    films: [...filmEpochs],
  }
}

function apply(e: WorldEvent) {
  const s = useMuseum.getState()
  switch (e.kind) {
    case 'gate':
      if (s.gate === 'closed') s.set({ gate: 'opening', nearGate: false })
      break
    case 'door': {
      const d = s.doors[e.index]
      if (e.state === 'opening' && d?.state !== 'opening' && d?.state !== 'open') {
        s.set({ doors: { ...s.doors, [e.index]: { state: 'opening', dir: e.dir } }, nearDoor: s.nearDoor?.index === e.index ? null : s.nearDoor })
      } else if (e.state === 'closing' && (d?.state === 'open' || d?.state === 'opening')) {
        s.set({ doors: { ...s.doors, [e.index]: { state: 'closing', dir: d.dir } } })
      }
      break
    }
    case 'film':
      filmEpochs.set(e.id, e.epoch)
      break
    case 'voice':
      voiceTriggers.get(e.id)?.()
      break
    case 'snapshot': {
      // Arriving late: take the doors as they are now (already open, no swing or creak)
      const doors = { ...s.doors }
      for (const { index, dir } of e.doors) if (doors[index]?.state !== 'open') doors[index] = { state: 'open', dir }
      s.set({ doors, ...(e.gate && s.gate === 'closed' ? { gate: 'open' as const, nearGate: false } : {}) })
      for (const [id, epoch] of e.films) filmEpochs.set(id, epoch)
      break
    }
  }
}

/** Keep this screen's museum in step with what the others do. */
export function useSharedWorld() {
  useEffect(() => onWorld(apply), [])
  // A new visit starts from a fresh museum
  useEffect(() => () => filmEpochs.clear(), [])
}
