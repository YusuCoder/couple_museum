import { createContext } from 'react'

import type { RoomShape } from './floorplan'

/** The room being rendered: its world-z centre (exhibits use room-local coordinates) and shape. */
export interface RoomInfo {
  z: number
  shape: RoomShape
}

export const RoomCtx = createContext<RoomInfo>({ z: 0, shape: 'hall' })
