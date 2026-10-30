import type { RoomShape } from './floorplan'

/**
 * left/right/end/intro – the hall's walls; panel – a face of one of the
 * hall's free-standing walls (see PANELS); free – an explicit spot (x, z,
 * rotY) used by the rotunda and corridor.
 */
export type Wall = 'left' | 'right' | 'end' | 'intro' | 'panel' | 'free'

export interface Exhibit {
  id: string
  /** photo (default) or video — a film shown on an in-wall screen. */
  kind?: 'photo' | 'video'
  title: string
  date: string
  caption: string
  /** Image URL. When missing, a generated placeholder is shown. */
  src?: string
  /** Video URL for kind 'video'. Plays with positional sound when you're near. */
  video?: string
  /** Voice note URL. Plays from the exhibit when you walk up to it. */
  voice?: string
  /** Width / height. Used for placeholders and as a fallback before the image loads. */
  aspect: number
  wall: Wall
  /** Position along the wall in metres (z for side walls and panels, x for the end/intro walls). */
  along: number
  /** For wall 'panel': which panel, and which face (left faces the left wall). */
  panel?: number
  face?: 'left' | 'right'
  /** For wall 'free': room-local position of the frame face and the direction it faces. */
  x?: number
  z?: number
  rotY?: number
  /** Height of the wall it hangs on (keeps its light pool on the wall). */
  top?: number
  /** Hangs on a dark wall — needs a stronger light pool to show. */
  dark?: boolean
  /** Radius of a concave (curved) wall it hangs on; x/z then lie just inside that wall. */
  curve?: number
  /** Hangs on fine wires from the ceiling (Skylight room) instead of on a wall. */
  hang?: boolean
  /** Long side of the photo in metres. */
  size?: number
  /** Placeholder palette (two gradient colours). */
  hue?: [string, string]
}

/** One chapter of the building, ready to hang: exhibit positions are room-local. */
export interface RoomContent {
  id: string
  shape: RoomShape
  title: string
  subtitle: string
  exhibits: Exhibit[]
}

export const ROOM = {
  width: 14, // x: -7..7
  length: 34, // z: -17..17
  height: 5.5,
  eyeHeight: 1.65,
  artHeight: 1.6, // centre of frames from floor
}

/** Free-standing intro wall near the entrance: title on the front, a film on the back. */
export const INTRO = { width: 5.6, height: 4.4, z: ROOM.length / 2 - 5, depth: 0.25 }
/** The film on the back of the intro wall: its bottom edge clears the heads of people on the bench. */
export const INTRO_FILM = { width: 4.6, bottom: 1.1, maxHeight: 3.1 }

/** Free-standing walls down the middle of the hall, each showing a large piece on both faces. */
export const PANELS = [
  { z: 3, length: 5.6, height: 3.6, thickness: 0.3 },
  { z: -7.5, length: 5.6, height: 3.6, thickness: 0.3 },
]
