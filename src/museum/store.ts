import * as THREE from 'three'
import { create } from 'zustand'

import { DEMO_ROOMS } from './demo'
import type { Exhibit, RoomContent } from './exhibits'
import type { RoomInfo } from './roomContext'
import { isTouch } from './touch'

/**
 * intro    – title screen, nothing started yet
 * walking  – pointer locked, free movement
 * paused   – pointer released (Esc), overlay shown
 * viewing  – camera parked in front of an exhibit, cursor free
 * returning – camera gliding back to where the visitor stood
 * sitting  – on a bench (pointer locked, looking around, no walking)
 */
export interface DoorState {
  state: 'closed' | 'opening' | 'open' | 'closing'
  /** Which way the leaves swing: -1 into the next room, 1 back towards the previous one. */
  dir: -1 | 1
}

export type Mode = 'intro' | 'walking' | 'paused' | 'viewing' | 'returning' | 'sitting'

interface MuseumState {
  mode: Mode
  focusedId: string | null
  viewingId: string | null
  music: boolean
  /** Camera: through the visitor's eyes, or behind their walking character. */
  view: 'first' | 'third'
  /** Drops to 'low' (no ambient occlusion, lower resolution) if the frame rate struggles. */
  quality: 'high' | 'low'
  /** The building's rooms (chapters) in walking order. */
  rooms: RoomContent[]
  /** Every exhibit in story order, across rooms (derived from rooms). */
  exhibits: Exhibit[]
  /** The front door: visitors start outside and open it with E. */
  gate: 'closed' | 'opening' | 'open'
  /** Close enough to the front door to open it. */
  nearGate: boolean
  /** Doors between rooms, by doorway index (door k joins room k and k + 1); missing = closed. */
  doors: Record<number, DoorState>
  /** The interior door the visitor can open right now, and the chapter it leads to. */
  nearDoor: { index: number; label: string } | null
  /** Standing at a bench: E sits down. */
  nearSeat: boolean
  /** Couple names and year for the title wall. */
  names: string
  since: string
  /** Which of the couple this visitor walks as (the museum's owner is him; anyone they share it with, her). */
  me: 'him' | 'her'
  /** The other one is in the museum right now (walking together). */
  partnerHere: boolean
  /** The walking-together link: live, still connecting, this device only, or failed (with why). */
  link: { state: 'connecting' | 'live' | 'device' | 'failed'; why?: string }
  set: (s: Partial<Omit<MuseumState, 'set'>>) => void
}

export const useMuseum = create<MuseumState>((set) => ({
  mode: 'intro',
  focusedId: null,
  viewingId: null,
  music: true,
  view: 'third',
  quality: isTouch ? 'low' : 'high',
  rooms: DEMO_ROOMS,
  exhibits: DEMO_ROOMS.flatMap((r) => r.exhibits),
  gate: 'closed',
  nearGate: false,
  doors: {},
  nearDoor: null,
  nearSeat: false,
  names: 'Aziz & Malika',
  since: '2021',
  me: 'him',
  partnerHere: false,
  link: { state: 'connecting' },
  set,
}))

/** What the interaction layer needs to know about each mounted exhibit. Not reactive. */
export interface ExhibitHandle {
  exhibit: Exhibit
  /** Invisible plane covering the whole frame, used for look-at raycasts. */
  hit: THREE.Object3D
  /** World-space centre of the frame face and its outward normal. */
  center: THREE.Vector3
  normal: THREE.Vector3
  width: number
  height: number
  /** Restart the exhibit's voice note / film from the beginning. */
  replay?: () => void
  /** The room it hangs in (keeps the viewing spot inside that room). */
  room: RoomInfo
}

export const exhibitRegistry = new Map<string, ExhibitHandle>()

/** Walls and other solid scenery that block the look-at ray (can't focus a photo through a wall). */
export const occluders = new Set<THREE.Object3D>()
