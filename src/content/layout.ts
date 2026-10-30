import { CORRIDOR, ROTUNDA, type RoomShape } from '../museum/floorplan'
import { INTRO, INTRO_FILM, PANELS, type Exhibit, type RoomContent, type Wall } from '../museum/exhibits'
import type { StoredMoment, StoredMuseum } from './db'

/**
 * How a room's moments are hung:
 * - its first film goes to the room's film spot (hall: back of the title wall;
 *   rotunda: back of the centre wall; corridor: none, films hang in line),
 * - the last room's last moment is the finale on its far wall; earlier halls
 *   flank their exit doorway with their last two moments,
 * - the rest fill the room's best spots first (big ones), then are hung in
 *   story order along the walk.
 */
interface Slot {
  wall: Wall
  along: number
  panel?: number
  face?: 'left' | 'right'
  /** wall 'free': room-local position and facing. */
  x?: number
  z?: number
  rotY?: number
  top?: number
  dark?: boolean
  curve?: number
  hang?: boolean
  /** Shows a bigger piece. */
  large?: boolean
}

interface Template {
  /** In fill priority. */
  slots: Slot[]
  /** Where the first film plays (if the shape has a special spot for it). */
  film?: Slot
  /** Far-wall finale when this is the last room. */
  finale: Slot
  /** Pieces either side of the exit doorway when another room follows. */
  flanks: Slot[]
  size: (m: StoredMoment, slot: Slot) => number
}

// ---------------------------------------------------------------- hall

const HALL_SIDE_Z = [9, 4.5, 0, -4.5, -9, -13.5]

const HALL: Template = {
  slots: [
    ...PANELS.flatMap((_, panel) =>
      (['left', 'right'] as const).map((face): Slot => ({ wall: 'panel', along: 0, panel, face, large: true, dark: true })),
    ),
    ...HALL_SIDE_Z.flatMap((z): Slot[] => [
      { wall: 'left', along: z },
      { wall: 'right', along: z },
    ]),
  ],
  film: { wall: 'intro', along: 0, large: true },
  finale: { wall: 'end', along: 0, dark: true },
  flanks: [
    { wall: 'end', along: -4.25, dark: true },
    { wall: 'end', along: 4.25, dark: true },
  ],
  // Photos: frame shaped to the photo. Videos: one standard screen per kind of spot.
  size: (m, slot) =>
    slot.large ? (m.kind === 'video' ? 2.7 : m.aspect >= 1 ? 2.5 : 2.1) : m.kind === 'video' ? 1.7 : m.aspect > 1.3 ? 1.5 : 1.2,
}

// ---------------------------------------------------------------- rotunda

/** Skylight room: five pictures hanging on wires on each side, in a ring inside the round wall. */
const FLOAT_RING = ROTUNDA.radius - 1.6
const ROTUNDA_WALL: Slot[] = (() => {
  const out: Slot[] = []
  const r = FLOAT_RING
  for (let k = 0; k < 5; k++) {
    const a = 0.6 + (k * (Math.PI - 1.2)) / 4
    for (const side of [-1, 1]) {
      const angle = side * a
      // On the wall at this angle, facing the centre
      out.push({
        wall: 'free',
        along: 0,
        x: r * Math.sin(angle),
        z: r * Math.cos(angle),
        rotY: angle + Math.PI,
        hang: true,
      })
    }
  }
  return out
})()

/** Skylight room: the big piece (or film) hangs in the beam of light, just behind the title on the floor. */
export const SKYLIGHT_CENTRE = { z: -1.4, titleZ: 1.7 }
const ROTUNDA_BACK: Slot = {
  wall: 'free',
  along: 0,
  x: 0,
  z: SKYLIGHT_CENTRE.z,
  rotY: 0,
  large: true,
  hang: true,
}

const ROTUNDA_T: Template = {
  slots: [ROTUNDA_BACK, ...ROTUNDA_WALL],
  film: ROTUNDA_BACK,
  finale: { wall: 'free', along: 0, x: 0, z: -FLOAT_RING + 0.2, rotY: 0, hang: true },
  flanks: [],
  size: (m, slot) =>
    slot.large ? (m.kind === 'video' ? 3.8 : m.aspect >= 1 ? 2.6 : 2.1) : m.kind === 'video' ? 1.6 : m.aspect > 1.3 ? 1.5 : 1.2,
}

// ---------------------------------------------------------------- corridor

/** Staggered left/right rhythm down the corridor; the chapter title is on the left wall by the entrance. */
export const CORRIDOR_TITLE_Z = CORRIDOR.length / 2 - 1.8
const CORRIDOR_SLOTS: Slot[] = (() => {
  const out: Slot[] = []
  const half = CORRIDOR.width / 2
  for (let k = 0; k < 7; k++) {
    out.push({ wall: 'free', along: 0, x: -half, z: 9.4 - k * 3.6, rotY: Math.PI / 2, dark: true, top: CORRIDOR.height })
    out.push({ wall: 'free', along: 0, x: half, z: 11.2 - k * 3.6, rotY: -Math.PI / 2, dark: true, top: CORRIDOR.height })
  }
  return out
})()

const CORRIDOR_T: Template = {
  slots: CORRIDOR_SLOTS,
  finale: { wall: 'free', along: 0, x: 0, z: -CORRIDOR.length / 2 + 0.01, rotY: 0, dark: true, top: CORRIDOR.height },
  flanks: [],
  // Intimate scale: smaller prints
  size: (m) => (m.kind === 'video' ? 1.5 : m.aspect > 1.3 ? 1.3 : 1.05),
}

const TEMPLATES: Record<RoomShape, Template> = { hall: HALL, rotunda: ROTUNDA_T, corridor: CORRIDOR_T }

// ---------------------------------------------------------------- shared

function slotZ(s: Slot) {
  if (s.wall === 'panel') return PANELS[s.panel!].z
  if (s.wall === 'free') return s.z ?? 0
  if (s.wall === 'intro') return INTRO.z
  return s.along
}
function slotX(s: Slot) {
  if (s.wall === 'free') return s.x ?? 0
  return s.wall === 'left' || s.face === 'left' ? -1 : 1
}
/** Distance from the entrance, so chosen spots are visited in story order (left before right). */
const walkOrder = (s: Slot) => -slotZ(s) * 10 + (slotX(s) < 0 ? 0 : 1)

const farWallSpaces = (t: Template, isLast: boolean) => (isLast ? 1 : t.flanks.length)

export function roomCapacity(moments: StoredMoment[], isLast: boolean, shape: RoomShape = 'hall') {
  const t = TEMPLATES[shape]
  // A film-only spot (the hall's title wall) only counts when there is a film
  const filmSpot = t.film && !t.slots.includes(t.film) && moments.some((m) => m.kind === 'video') ? 1 : 0
  return t.slots.length + farWallSpaces(t, isLast) + filmSpot
}

export interface MediaUrls {
  media: Map<string, string>
  voice: Map<string, string>
}

/** Hang one room's moments. */
export function layoutRoom(moments: StoredMoment[], urls: MediaUrls, isLast: boolean, shape: RoomShape = 'hall'): Exhibit[] {
  const t = TEMPLATES[shape]
  // The first film gets the room's film spot; if that spot is shared (rotunda), it leaves the pool
  const filmIndex = t.film ? moments.findIndex((m) => m.kind === 'video') : -1
  const film = filmIndex >= 0 ? moments[filmIndex] : undefined
  const pool = film && t.slots.includes(t.film!) ? t.slots.filter((s) => s !== t.film) : t.slots

  let rest = moments.filter((_, i) => i !== filmIndex).slice(0, pool.length + farWallSpaces(t, isLast))

  // Far wall: the finale (last room) or the pieces flanking the doorway
  let farWall: StoredMoment[] = []
  if (isLast && rest.length > 1) farWall = rest.slice(-1)
  else if (!isLast && t.flanks.length && rest.length >= 3) farWall = rest.slice(-t.flanks.length)
  rest = rest.slice(0, rest.length - farWall.length)

  const slots = pool.slice(0, rest.length).sort((a, b) => walkOrder(a) - walkOrder(b))
  const placed = rest.map((m, i) => ({ m, slot: slots[i] }))

  // A film looks best big: if one landed on a small spot, swap it with the nearest big photo
  for (const f of placed.filter((p) => p.m.kind === 'video' && !p.slot.large)) {
    const big = placed
      .filter((p) => p.m.kind === 'photo' && p.slot.large)
      .sort((a, b) => Math.abs(walkOrder(a.slot) - walkOrder(f.slot)) - Math.abs(walkOrder(b.slot) - walkOrder(f.slot)))[0]
    if (big) [f.m, big.m] = [big.m, f.m]
  }

  const toExhibit = (m: StoredMoment, slot: Slot, size: number): Exhibit => ({
    id: m.id,
    kind: m.kind,
    title: m.title || 'Untitled',
    date: m.date,
    caption: m.caption,
    aspect: m.aspect,
    wall: slot.wall,
    along: slot.along,
    panel: slot.panel,
    face: slot.face,
    x: slot.x,
    z: slot.z,
    rotY: slot.rotY,
    top: slot.top,
    dark: slot.dark,
    curve: slot.curve,
    hang: slot.hang,
    size,
    src: m.kind === 'photo' ? urls.media.get(m.id) : undefined,
    video: m.kind === 'video' ? urls.media.get(m.id) : undefined,
    voice: m.voice ? urls.voice.get(m.id) : undefined,
  })

  const out: Exhibit[] = []
  if (film && t.film) out.push(toExhibit(film, t.film, t.film.wall === 'intro' ? INTRO_FILM.width : t.size(film, t.film)))
  for (const { m, slot } of placed) out.push(toExhibit(m, slot, t.size(m, slot)))
  if (isLast && farWall[0]) {
    const hero = farWall[0]
    const big = shape === 'corridor' ? 2.3 : shape === 'rotunda' ? 2.8 : 3.4
    out.push(toExhibit(hero, t.finale, hero.kind === 'video' ? big * 0.94 : hero.aspect >= 1 ? big : big * 0.76))
  } else {
    farWall.forEach((m, i) => out.push(toExhibit(m, t.flanks[i], m.kind === 'video' ? 2.2 : m.aspect >= 1 ? 2.1 : 1.7)))
  }
  return out
}

/** Hang the whole building: one entry per room, in walking order. */
export function layoutBuilding(museum: StoredMuseum, urls: MediaUrls): RoomContent[] {
  return museum.rooms.map((room, i) => {
    const shape = room.shape ?? 'hall'
    return {
      id: room.id,
      shape,
      title: room.title || `Chapter ${i + 1}`,
      subtitle: room.subtitle,
      exhibits: layoutRoom(
        museum.moments.filter((m) => m.roomId === room.id && urls.media.has(m.id)),
        urls,
        i === museum.rooms.length - 1,
        shape,
      ),
    }
  })
}
