import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider } from '@react-three/rapier'

import { playerState } from './Player'
import { useMuseum } from './store'
import { controlling } from './touch'

/**
 * Benches you can sit on. Walk up to one and press E: the visitor turns
 * round, sits down on the side they are standing on (so walking up from in
 * front of a film means sitting facing it) and the camera settles on the view.
 * E, Space or any walking key stands them up again.
 */

export const SEAT_HEIGHT = 0.45
/** Offered when the visitor's body is this close to the bench's long edge (m). */
const REACH = 1.2
/** Keep the seated body this far in from the bench ends. */
const END_MARGIN = 0.35

export interface Seat {
  /** Where the hips rest, on the seat. */
  x: number
  z: number
  /** Facing (radians, character convention: forward = (sin, cos)). */
  yaw: number
  /** sit down → sitting → stand up; then the seat is cleared. */
  phase: 'down' | 'sitting' | 'up'
  /** The bench's long axis (unit, world), and the free length either way along it (m) — room for a second person. */
  along: { x: number; z: number }
  room: { back: number; ahead: number }
}

/** Where to stand so the sit-down clip lowers the hips on to `seat`. */
export function standPoint(seat: Pick<Seat, 'x' | 'z' | 'yaw'>, sitShift: number) {
  return { x: seat.x + Math.sin(seat.yaw) * sitShift, z: seat.z + Math.cos(seat.yaw) * sitShift }
}

interface BenchHandle {
  obj: THREE.Object3D
  half: number
}
const benches = new Set<BenchHandle>()

const _c = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _along = new THREE.Vector3()

/** The spot the visitor would sit on right now, if any. */
function seatFor(pos: THREE.Vector3): Omit<Seat, 'phase'> | null {
  let best: { seat: Omit<Seat, 'phase'>; d: number } | null = null
  for (const b of benches) {
    b.obj.getWorldPosition(_c)
    b.obj.getWorldQuaternion(_q)
    _along.set(0, 0, 1).applyQuaternion(_q).setY(0).normalize()
    const dx = pos.x - _c.x
    const dz = pos.z - _c.z
    const a = dx * _along.x + dz * _along.z
    // Perpendicular (across the bench): along rotated -90° about y
    const s = dx * _along.z - dz * _along.x
    if (Math.abs(a) > b.half + 0.2 || Math.abs(s) > REACH) continue
    const d = Math.abs(s)
    if (best && best.d < d) continue
    const side = s >= 0 ? 1 : -1
    const fx = _along.z * side
    const fz = -_along.x * side
    const t = THREE.MathUtils.clamp(a, -b.half + END_MARGIN, b.half - END_MARGIN)
    best = {
      d,
      seat: {
        x: _c.x + _along.x * t + fx * 0.04,
        z: _c.z + _along.z * t + fz * 0.04,
        yaw: Math.atan2(fx, fz),
        along: { x: _along.x, z: _along.z },
        room: { back: t - (-b.half + END_MARGIN), ahead: b.half - END_MARGIN - t },
      },
    }
  }
  return best?.seat ?? null
}

/** Sit on the bench the visitor is standing at. */
export function sitDown() {
  const s = useMuseum.getState()
  if (s.mode !== 'walking' || playerState.seat) return false
  const seat = seatFor(playerState.position)
  if (!seat) return false
  // Stand just in front of the seat; the clip lowers the hips back on to it
  playerState.teleport = standPoint(seat, playerState.sitShift)
  playerState.seat = { ...seat, phase: 'down' }
  s.set({ mode: 'sitting', nearSeat: false, focusedId: null })
  return true
}

/** Get up (once fully seated). */
export function standUp() {
  const seat = playerState.seat
  if (!seat || seat.phase !== 'sitting') return false
  seat.phase = 'up'
  return true
}

/** Called by the Character when the stand-up clip ends: walking again (the clip has brought the feet back to where they stood). */
export function finishStanding() {
  if (!playerState.seat) return
  playerState.seat = null
  const s = useMuseum.getState()
  if (s.mode === 'sitting') s.set({ mode: controlling() ? 'walking' : 'paused' })
}

/** Offers a seat when the visitor walks up to a bench. */
export function SeatWatcher() {
  useFrame(() => {
    const s = useMuseum.getState()
    const near = s.mode === 'walking' && !playerState.seat && seatFor(playerState.position) !== null
    if (near !== s.nearSeat) s.set({ nearSeat: near })
  })
  return null
}

/** Oak-and-steel gallery bench; seats along its length (local z). */
export function Bench({ position, rotation = 0, length = 2.4 }: { position: [number, number, number]; rotation?: number; length?: number }) {
  const ref = useRef<THREE.Group>(null)
  useEffect(() => {
    const handle = { obj: ref.current!, half: length / 2 }
    benches.add(handle)
    return () => {
      benches.delete(handle)
    }
  }, [length])
  const seatH = SEAT_HEIGHT
  return (
    <group ref={ref} position={position} rotation-y={rotation}>
      <CuboidCollider args={[0.28, seatH / 2, length / 2]} position={[0, seatH / 2, 0]} />
      <mesh position-y={seatH - 0.03}>
        <boxGeometry args={[0.5, 0.06, length]} />
        <meshStandardMaterial color="#8a6440" roughness={0.55} />
      </mesh>
      {[-length / 2 + 0.2, length / 2 - 0.2].map((z) => (
        <mesh key={z} position={[0, (seatH - 0.06) / 2, z]}>
          <boxGeometry args={[0.44, seatH - 0.06, 0.04]} />
          <meshStandardMaterial color="#1c1c1c" roughness={0.35} metalness={0.8} />
        </mesh>
      ))}
    </group>
  )
}
