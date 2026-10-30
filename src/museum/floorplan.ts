import { ROOM } from './exhibits'

/**
 * World layout of the building. The front door is at z = 0 and rooms follow
 * one another towards -z. Each room owns its near wall (except the first,
 * whose near wall is the facade) and its far wall, both with doorways, so
 * rooms of different shapes and widths always meet cleanly.
 *
 *   plaza (+z) |facade| room 0 || room 1 || room 2 ...
 */
export const WALL = 0.3 // interior wall thickness

/** hall: the big bright gallery · rotunda: round, domed · corridor: long and narrow */
export type RoomShape = 'hall' | 'rotunda' | 'corridor'

export interface ShapeSpec {
  /** Interior size, metres (rotunda: width = diameter, length adds the two short vestibules). */
  width: number
  length: number
  /** Wall height (the rotunda's dome rises above this). */
  height: number
}

export const ROTUNDA = { radius: 9.5, vestibule: 1, dome: 3, oculus: 1.6 }
export const CORRIDOR = { width: 6, length: 28, height: 4.2 }

export const SHAPES: Record<RoomShape, ShapeSpec> = {
  hall: { width: ROOM.width, length: ROOM.length, height: ROOM.height },
  rotunda: {
    width: ROTUNDA.radius * 2,
    length: ROTUNDA.radius * 2 + ROTUNDA.vestibule * 2,
    height: ROOM.height,
  },
  corridor: { width: CORRIDOR.width, length: CORRIDOR.length, height: CORRIDOR.height },
}

/** Widest interior of any shape plus walls: the floor and the outer walls are this wide. */
export const BUILDING_HALF_WIDTH = Math.max(...Object.values(SHAPES).map((s) => s.width / 2)) + WALL

/** Where each room sits along the building. */
export interface BuildingPlan {
  shapes: RoomShape[]
  /** World z of each room's centre (room-local coordinates are relative to it). */
  centers: number[]
  /** Total length from the facade to the back wall. */
  length: number
}

export function buildingPlan(shapes: RoomShape[]): BuildingPlan {
  const centers: number[] = []
  let z = 0
  shapes.forEach((shape, i) => {
    if (i > 0) z -= WALL // this room's own near wall
    const len = SHAPES[shape].length
    centers.push(z - len / 2)
    z -= len + WALL // its far wall
  })
  return { shapes, centers, length: -z }
}

/** Which room a world z falls in (outside counts as the first room). */
export function roomIndexAt(z: number, plan: BuildingPlan) {
  for (let i = 0; i < plan.centers.length; i++) {
    const half = SHAPES[plan.shapes[i]].length / 2 + WALL
    if (z > plan.centers[i] - half) return i
  }
  return Math.max(plan.centers.length - 1, 0)
}

/** Doorway between rooms. */
export const DOORWAY = { width: 3, height: 3.6 }

/** The front of the building: a concrete wall, wider than the galleries, with the double door. */
export const FACADE = {
  depth: 0.8, // from z = 0 out to z = depth
  height: 9,
}
/** Half-width of the facade: a little beyond the building's outer walls. */
export const FACADE_HALF = BUILDING_HALF_WIDTH + 1
export const GATE = { width: 3.2, height: 4.6 }

/** Where visitors arrive: an open plaza bounded by hedges. */
export const PLAZA = { halfWidth: 17, depth: 30 }
export const SPAWN_OUTSIDE: [number, number] = [0, 20]
