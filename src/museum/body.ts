import * as THREE from 'three'

import type { Seat } from './Seats'

/**
 * Everything an Avatar needs to know about the body it dresses, and what it
 * reports back. The visitor's body (playerState) and the companion's
 * (partnerState) both have this shape.
 */
export interface Body {
  /** Capsule centre. */
  position: THREE.Vector3
  velocity: THREE.Vector3
  /** On a bench (see Seats). */
  seat: Seat | null
  /** One-shot facing request (radians, forward = (sin, cos)), consumed by the Avatar. */
  faceYaw: number | null
  /** Standing still: turn to face this way (null = keep facing where they were going). */
  holdYaw: number | null
  /** 0..1: how far into the embrace (both bodies share the same value). */
  embrace: number
  /** Written by the Avatar: the facing actually shown. */
  yaw: number
  /** Written by the Avatar: how far the sit-down clip carries the hips back on to the seat (m). */
  sitShift: number
}

export function makeBody(): Body {
  return {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    seat: null,
    faceYaw: null,
    holdYaw: null,
    embrace: 0,
    yaw: 0,
    sitShift: 0.49,
  }
}
