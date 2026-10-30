import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useKeyboardControls } from '@react-three/drei'
import { CapsuleCollider, RigidBody, interactionGroups, useRapier, type RapierRigidBody } from '@react-three/rapier'

import { audio } from './audio'
import { makeBody } from './body'
import { ROOM } from './exhibits'
import type { Seat } from './Seats'
import { useMuseum } from './store'
import { RUN_PUSH, isTouch, stick } from './touch'

export type Controls = 'forward' | 'backward' | 'left' | 'right' | 'run'

export const KEYMAP: { name: Controls; keys: string[] }[] = [
  { name: 'forward', keys: ['KeyW', 'ArrowUp'] },
  { name: 'backward', keys: ['KeyS', 'ArrowDown'] },
  { name: 'left', keys: ['KeyA', 'ArrowLeft'] },
  { name: 'right', keys: ['KeyD', 'ArrowRight'] },
  { name: 'run', keys: ['ShiftLeft', 'ShiftRight'] },
]

export const WALK = 1.5 // m/s — unhurried museum pace
export const RUN = 3.0
export const RADIUS = 0.3
export const HALF_HEIGHT = 0.55
/**
 * Collision groups: the scenery is in every group; the visitor (1) and the
 * companion (2) only collide with group 0, so they can stand close together
 * (the embrace) and never shove each other. Queries that should only see the
 * scenery use SCENERY.
 */
export const VISITOR_GROUPS = interactionGroups(1, [0])
export const COMPANION_GROUPS = interactionGroups(2, [0])
export const SCENERY = interactionGroups(0, [0])
export const CENTER_Y = HALF_HEIGHT + RADIUS
const EYE_OFFSET = ROOM.eyeHeight - CENTER_Y

// Third-person camera: over the right shoulder, pulled in when a wall is behind
const THIRD = { distance: 2.3, pivotY: 1.5 - CENTER_Y, shoulder: 0.38, wallGap: 0.25 }

/** Where the visitor's body is and how it moves — read by the walking character (see Body). */
export const playerState = {
  ...makeBody(),
  /** Move the body to this spot (and, if given, face this way: yaw, radians). */
  teleport: null as null | { x: number; z: number; yaw?: number },
  /** Height the third-person camera must stay under (current room's ceiling, or open sky). */
  ceiling: 6,
}

/** Over-the-shoulder offset; on a narrow (portrait) screen, over his left shoulder instead — she walks on that side, so the two of them share the frame. */
const shoulder = (aspect: number) => (aspect < 1 ? -0.4 : THIRD.shoulder)
/** Portrait: stand further back so the companion at his side stays in the frame. */
const followDistance = (aspect: number) => THIRD.distance * (aspect < 1 ? 1.3 : 1)
/** Seated (third person): closer in and higher, looking over the couple's heads at what they're watching. */
const SEATED_CAMERA = { distance: 1.9, portraitDistance: 2.3, lift: 0.35, pitch: 0.04 }

/** Third-person camera pose for a body position and gaze, ignoring walls (for camera glides). */
export function thirdPersonPose(body: THREE.Vector3, quat: THREE.Quaternion, aspect = 1.6) {
  const gaze = new THREE.Vector3(0, 0, -1).applyQuaternion(quat)
  const flat = gaze.clone().setY(0).normalize()
  const right = flat.clone().cross(UP)
  return new THREE.Vector3(body.x, body.y + THIRD.pivotY, body.z)
    .addScaledVector(right, shoulder(aspect))
    .addScaledVector(gaze, -followDistance(aspect))
}

const forward = new THREE.Vector3()
const look = new THREE.Vector3()
const side = new THREE.Vector3()
const wish = new THREE.Vector3()
const pivot = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)
const seatBase = new THREE.Vector3()
const camTarget = new THREE.Vector3()
/** How much lower the eyes are when seated. */
const SEATED_DROP = 0.42
const turn = { t: 1, from: new THREE.Quaternion(), to: new THREE.Quaternion() }

export function Player({ spawn }: { spawn: [number, number] }) {
  const body = useRef<RapierRigidBody>(null)
  const [, get] = useKeyboardControls<Controls>()
  const { world, rapier } = useRapier()
  const velocity = useRef(new THREE.Vector3())
  const bobPhase = useRef(0)
  const lastStep = useRef(0)
  const camDistance = useRef(THIRD.distance)
  const lastSeat = useRef<Seat | null>(null)
  const easeCamera = useRef(0)

  useFrame(({ camera }, dt) => {
    const rb = body.current
    if (!rb) return
    dt = Math.min(dt, 0.05)
    const { mode, view } = useMuseum.getState()

    const tp = playerState.teleport
    if (tp) {
      playerState.teleport = null
      rb.setTranslation({ x: tp.x, y: CENTER_Y + 0.02, z: tp.z }, true)
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true)
      velocity.current.set(0, 0, 0)
      camDistance.current = THIRD.distance
      playerState.position.set(tp.x, CENTER_Y + 0.02, tp.z)
      playerState.velocity.set(0, 0, 0)
      if (tp.yaw !== undefined) playerState.faceYaw = tp.yaw
    }

    // In view mode the camera belongs to the interaction layer
    if (mode === 'viewing' || mode === 'returning') return

    const seat = playerState.seat
    if (seat !== lastSeat.current) {
      // Sitting down or getting up: ease the camera over instead of jumping
      if (!seat || !lastSeat.current) easeCamera.current = 0.8
      // Sitting down: turn to face the way the visitor will sit
      if (seat && !lastSeat.current) {
        turn.from.copy(camera.quaternion)
        turn.to.setFromEuler(new THREE.Euler(view === 'first' ? -0.07 : SEATED_CAMERA.pitch, Math.atan2(-Math.sin(seat.yaw), -Math.cos(seat.yaw)), 0, 'YXZ'))
        turn.t = 0
      }
      lastSeat.current = seat
    }
    if (turn.t < 1) {
      turn.t = Math.min(turn.t + dt / 1.3, 1)
      const k = turn.t < 0.5 ? 4 * turn.t ** 3 : 1 - (-2 * turn.t + 2) ** 3 / 2
      camera.quaternion.slerpQuaternions(turn.from, turn.to, k)
    }
    easeCamera.current = Math.max(easeCamera.current - dt, 0)

    camera.getWorldDirection(look)
    forward.copy(look).setY(0).normalize()
    side.crossVectors(forward, UP)

    // Only walk while pointer-locked (and not seated)
    const k = get()
    wish.set(0, 0, 0)
    if (mode === 'walking' && !seat) {
      wish
        .addScaledVector(forward, Number(k.forward) - Number(k.backward))
        .addScaledVector(side, Number(k.right) - Number(k.left))
      if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(k.run ? RUN : WALK)
      else if (isTouch) {
        // Thumb stick: a gentle push strolls, a full push runs
        const push = Math.min(Math.hypot(stick.x, stick.y), 1)
        if (push > 0.15) {
          wish.addScaledVector(forward, stick.y).addScaledVector(side, stick.x).normalize()
          wish.multiplyScalar(push >= RUN_PUSH ? RUN : WALK * Math.max(push / RUN_PUSH, 0.45))
        }
      }
    }

    // Eased acceleration/deceleration instead of instant start/stop
    velocity.current.lerp(wish, 1 - Math.exp(-dt * (wish.lengthSq() > 0 ? 6 : 9)))
    const lv = rb.linvel()
    rb.setLinvel({ x: velocity.current.x, y: lv.y, z: velocity.current.z }, true)

    const speed = Math.hypot(velocity.current.x, velocity.current.z)
    bobPhase.current += dt * speed * 5.2

    // One footstep at each low point of the bob (sin(2φ) minima at φ = 3π/4 + kπ)
    const step = Math.floor((bobPhase.current - (3 * Math.PI) / 4) / Math.PI)
    if (step !== lastStep.current) {
      lastStep.current = step
      if (speed > 0.4) audio().footstep(Math.min(speed / WALK, 1.3))
    }

    const p = rb.translation()
    playerState.position.set(p.x, p.y, p.z)
    playerState.velocity.copy(velocity.current)

    // Seated: the camera works from the figure on the bench, not the body standing by it
    const base = seat ? seatBase.set(seat.x, CENTER_Y, seat.z) : seatBase.set(p.x, p.y, p.z)
    const drop = seat ? SEATED_DROP : 0
    const place = (target: THREE.Vector3) => {
      if (easeCamera.current > 0) camera.position.lerp(target, 1 - Math.exp(-dt * 7))
      else camera.position.copy(target)
    }

    if (view === 'first') {
      if (seat) {
        place(camTarget.set(base.x + Math.sin(seat.yaw) * 0.1, base.y + EYE_OFFSET - drop, base.z + Math.cos(seat.yaw) * 0.1))
        return
      }
      // Head-bob proportional to speed
      const bobAmount = Math.min(speed / WALK, 1.4)
      const bobY = Math.sin(bobPhase.current * 2) * 0.022 * bobAmount
      const bobX = Math.cos(bobPhase.current) * 0.012 * bobAmount
      place(camTarget.set(p.x + side.x * bobX, p.y + EYE_OFFSET + bobY, p.z + side.z * bobX))
      return
    }

    // Orbit behind the shoulder along the look direction; looking down lifts the camera
    const aspect = (camera as THREE.PerspectiveCamera).aspect
    const far = seat ? (aspect < 1 ? SEATED_CAMERA.portraitDistance : SEATED_CAMERA.distance) : followDistance(aspect)
    pivot.set(base.x, base.y + THIRD.pivotY - drop + (seat ? SEATED_CAMERA.lift : 0), base.z)
    if (seat && aspect < 1) {
      // Seated on a narrow (portrait) screen: straight behind the middle of the bench, so what they're watching is centred
      const toMiddle = (seat.room.ahead - seat.room.back) / 2
      pivot.x += seat.along.x * toMiddle
      pivot.z += seat.along.z * toMiddle
    } else pivot.addScaledVector(side, shoulder(aspect))
    const back = look.negate()
    const hit = world.castRay(
      new rapier.Ray(pivot, back),
      far + THIRD.wallGap,
      true,
      undefined,
      SCENERY,
      undefined,
      rb,
    )
    const target = hit ? Math.max(0.3, hit.timeOfImpact - THIRD.wallGap) : far
    // Snap in quickly when a wall appears, ease back out slowly
    const rate = target < camDistance.current ? 20 : 3
    camDistance.current += (target - camDistance.current) * (1 - Math.exp(-dt * rate))
    camTarget.copy(pivot).addScaledVector(back, camDistance.current)
    // Under the gallery ceiling inside; a little more headroom on the plaza
    camTarget.y = THREE.MathUtils.clamp(camTarget.y, 0.35, playerState.ceiling - 0.2)
    place(camTarget)
  })

  return (
    <RigidBody
      ref={body}
      colliders={false}
      mass={70}
      enabledRotations={[false, false, false]}
      position={[spawn[0], CENTER_Y + 0.05, spawn[1]]}
      linearDamping={0}
      friction={0}
      ccd
    >
      <CapsuleCollider args={[HALF_HEIGHT, RADIUS]} collisionGroups={VISITOR_GROUPS} />
    </RigidBody>
  )
}
