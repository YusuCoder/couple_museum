import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier'

import { makeBody } from './body'
import { Avatar, HER_MODEL } from './Character'
import { CENTER_Y, COMPANION_GROUPS, HALF_HEIGHT, RADIUS, RUN, SCENERY, WALK, playerState } from './Player'
import { standPoint, type Seat } from './Seats'
import { romance } from './Skylight'
import { useMuseum } from './store'

/**
 * Her, walking the museum with the visitor until the two of them can visit
 * together online: she keeps to his side (or falls in behind him through
 * doorways), sits beside him on benches, and in the Skylight room's circle of
 * light steps in close for the embrace — her hand on his shoulder, his arm
 * round her waist (see embrace.ts).
 */
export const partnerState = {
  ...makeBody(),
  teleport: null as null | { x: number; z: number },
  /** What she is doing (for debugging). */
  mode: 'follow' as Mode,
}

type Mode = 'follow' | 'toSeat' | 'seated' | 'toEmbrace' | 'embrace'

/** Standing beside him (m): to his left when there's room. */
const SIDE = 0.85
/** Embrace: how far to his left she stands, and how much each turns to the other. */
const HUG = { side: 0.42, ahead: 0.12, herTurn: -0.62, hisTurn: 0.22 }
/** Seconds to settle into the embrace, and to let go. */
const HUG_IN = 1.1
const HUG_OUT = 0.35
/** He must stand still this long in the light before she comes in. */
const STILL_BEFORE_HUG = 0.7
/** Gap between two people on a bench (m, centre to centre). */
const SEAT_GAP = 0.62

const fwd = (yaw: number) => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
const left = (yaw: number) => new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))

export function Partner({ spawn, yaw }: { spawn: [number, number]; yaw: number }) {
  const rb = useRef<RapierRigidBody>(null)
  const { world, rapier } = useRapier()
  const st = useRef({
    mode: 'follow' as Mode,
    goal: null as THREE.Vector3 | null,
    rest: null as null | { goal: THREE.Vector3; from: THREE.Vector3 },
    seat: null as Omit<Seat, 'phase'> | null,
    still: 0,
    stuck: 0,
    trail: [] as THREE.Vector3[],
    velocity: new THREE.Vector3(),
  })

  // Facing the same way as the visitor at the start (camera yaw → body yaw)
  const startYaw = Math.atan2(-Math.sin(yaw), -Math.cos(yaw))
  const startPos = new THREE.Vector3(spawn[0], 0, spawn[1]).add(left(startYaw).multiplyScalar(SIDE))
  if (st.current.trail.length === 0) {
    partnerState.yaw = startYaw
    partnerState.holdYaw = startYaw
  }

  /** Nothing solid between `from` and `to` (at hip height, with a little clearance). */
  const clear = (from: THREE.Vector3, to: THREE.Vector3) => {
    const d = new THREE.Vector3(to.x - from.x, 0, to.z - from.z)
    const len = d.length()
    if (len < 0.01) return true
    d.divideScalar(len)
    const ray = new rapier.Ray({ x: from.x, y: 1, z: from.z }, { x: d.x, y: 0, z: d.z })
    return world.castRay(ray, len + RADIUS + 0.1, true, undefined, SCENERY) === null
  }

  /** A point on his recent path about `back` metres behind him. */
  const behind = (back: number) => {
    const trail = st.current.trail
    let acc = 0
    for (let i = trail.length - 1; i > 0; i--) {
      acc += trail[i].distanceTo(trail[i - 1])
      if (acc >= back) return trail[i - 1].clone()
    }
    return trail[0]?.clone() ?? playerState.position.clone()
  }

  useFrame((_, rawDt) => {
    const body = rb.current
    if (!body) return
    const dt = Math.min(rawDt, 0.05)
    const s = st.current
    const me = partnerState
    const him = playerState
    const { mode: museumMode } = useMuseum.getState()

    if (me.teleport) {
      body.setTranslation({ x: me.teleport.x, y: CENTER_Y + 0.02, z: me.teleport.z }, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      s.velocity.set(0, 0, 0)
      me.teleport = null
    }
    const t = body.translation()
    me.position.set(t.x, t.y, t.z)

    // His recent path, for following through doorways
    const hp = him.position
    const lastPt = s.trail[s.trail.length - 1]
    if (!lastPt || lastPt.distanceTo(hp) > 0.3) {
      s.trail.push(hp.clone())
      if (s.trail.length > 80) s.trail.shift()
    }
    const hisSpeed = Math.hypot(him.velocity.x, him.velocity.z)
    s.still = hisSpeed < 0.1 && museumMode === 'walking' && !him.seat ? s.still + dt : 0
    const dist = Math.hypot(hp.x - me.position.x, hp.z - me.position.z)

    // ---- decide where to be
    let goal: THREE.Vector3 | null = null
    let maxSpeed = WALK
    const inLight = romance.inside.size > 0

    switch (s.mode) {
      case 'follow': {
        // He sat down: take the place beside him if the bench has room
        if (him.seat && him.seat.phase !== 'up') {
          const seat = him.seat
          const towardsLeft = seat.along.x * left(seat.yaw).x + seat.along.z * left(seat.yaw).z >= 0 ? 1 : -1
          const side = [towardsLeft, -towardsLeft].find((k) => (k > 0 ? seat.room.ahead : seat.room.back) >= SEAT_GAP)
          if (side !== undefined && !s.seat) {
            s.seat = {
              x: seat.x + seat.along.x * SEAT_GAP * side,
              z: seat.z + seat.along.z * SEAT_GAP * side,
              yaw: seat.yaw,
              along: seat.along,
              room: { back: 0, ahead: 0 },
            }
            s.mode = 'toSeat'
            break
          }
        } else s.seat = null
        // Standing together in the light: come in close
        if (inLight && s.still > STILL_BEFORE_HUG && dist < 5) {
          const F = fwd(him.yaw)
          s.goal = hp.clone().addScaledVector(left(him.yaw), HUG.side).addScaledVector(F, HUG.ahead)
          me.holdYaw = him.yaw + HUG.herTurn
          s.mode = 'toEmbrace'
          break
        }
        if (hisSpeed > 0.3) {
          // Walk at his side if there's room there, otherwise fall in behind him
          s.rest = null
          const F = new THREE.Vector3(him.velocity.x, 0, him.velocity.z).normalize()
          const L = new THREE.Vector3(F.z, 0, -F.x)
          const spot = hp.clone().addScaledVector(L, SIDE).addScaledVector(F, -0.35)
          goal = clear(hp, spot) ? spot : behind(1.3)
          maxSpeed = dist > 3 ? RUN + 0.4 : Math.max(WALK, hisSpeed + 0.4)
        } else {
          // He has stopped: pick a free place beside him once, and stay there
          if (!s.rest || s.rest.from.distanceTo(hp) > 0.6) {
            const L = left(him.yaw)
            const F = fwd(him.yaw)
            const options = [L.clone().multiplyScalar(SIDE), L.clone().multiplyScalar(-SIDE), F.clone().multiplyScalar(-0.9)]
            const pick = options.map((o) => hp.clone().add(o)).find((p) => clear(hp, p)) ?? behind(1)
            s.rest = { goal: pick, from: hp.clone() }
          }
          goal = s.rest.goal
          maxSpeed = dist > 3 ? RUN : WALK
          me.holdYaw = him.yaw
        }
        break
      }
      case 'toSeat': {
        if (!him.seat || him.seat.phase === 'up' || !s.seat) {
          s.mode = 'follow'
          s.seat = null
          break
        }
        const stand = standPoint(s.seat, me.sitShift)
        goal = new THREE.Vector3(stand.x, 0, stand.z)
        // Close enough (the bench itself keeps her body a little off the exact spot): step into place
        if (Math.hypot(stand.x - me.position.x, stand.z - me.position.z) < 0.25) {
          me.teleport = stand
          me.seat = { ...s.seat, phase: 'down' }
          s.mode = 'seated'
          goal = null
        }
        break
      }
      case 'seated': {
        // Get up with him
        if ((!him.seat || him.seat.phase === 'up') && me.seat?.phase === 'sitting') me.seat.phase = 'up'
        break
      }
      case 'toEmbrace':
      case 'embrace': {
        const leave = hisSpeed > 0.3 || !inLight || him.seat !== null || (museumMode !== 'walking' && museumMode !== 'paused')
        if (leave) {
          s.mode = 'follow'
          him.holdYaw = null
          break
        }
        goal = s.goal
        if (s.mode === 'toEmbrace' && Math.hypot(s.goal!.x - me.position.x, s.goal!.z - me.position.z) < 0.07) {
          s.mode = 'embrace'
          him.holdYaw = him.yaw + HUG.hisTurn
        }
        if (s.mode === 'embrace') goal = null
        break
      }
    }

    me.mode = s.mode

    // The embrace fades in once she's in place, and out as soon as either moves off
    const hugTarget = s.mode === 'embrace' ? 1 : 0
    me.embrace = THREE.MathUtils.clamp(me.embrace + (hugTarget ? dt / HUG_IN : -dt / HUG_OUT), 0, 1)
    him.embrace = me.embrace

    // ---- move towards the goal (arrive gently)
    const wish = new THREE.Vector3()
    if (goal && !me.seat) {
      wish.set(goal.x - me.position.x, 0, goal.z - me.position.z)
      const d = wish.length()
      // Hopelessly far behind (another room, stuck): catch up out of sight, behind him
      if (d > 12 || s.stuck > 1.5) {
        const back = behind(1.5)
        me.teleport = { x: back.x, z: back.z }
        s.stuck = 0
      }
      const near = s.mode === 'toEmbrace' || s.mode === 'toSeat' ? 0.02 : 0.12
      const speed = d < near ? 0 : Math.min(maxSpeed, (d - near) * 2.2 + 0.2)
      if (d > 1e-3) wish.multiplyScalar(speed / d)
    }
    s.velocity.lerp(wish, 1 - Math.exp(-dt * (wish.lengthSq() > 0 ? 6 : 9)))
    const lv = body.linvel()
    body.setLinvel({ x: s.velocity.x, y: lv.y, z: s.velocity.z }, true)

    // Not getting anywhere while trying to: count towards a catch-up
    const actual = Math.hypot(lv.x, lv.z)
    s.stuck = wish.length() > 0.6 && actual < 0.1 ? s.stuck + dt : 0
    me.velocity.set(lv.x, 0, lv.z)
    if (me.seat || s.mode === 'embrace') me.velocity.set(0, 0, 0)
  })

  return (
    <>
      <RigidBody
        ref={rb}
        colliders={false}
        mass={55}
        enabledRotations={[false, false, false]}
        position={[startPos.x, CENTER_Y + 0.05, startPos.z]}
        linearDamping={0}
        friction={0}
        ccd
      >
        <CapsuleCollider args={[HALF_HEIGHT, RADIUS]} collisionGroups={COMPANION_GROUPS} />
      </RigidBody>
      <Avatar
        url={HER_MODEL.url}
        who="her"
        height={HER_MODEL.height}
        body={partnerState}
        walkClip={HER_MODEL.walkClip}
        walkSpeed={HER_MODEL.walkSpeed}
        runSpeed={HER_MODEL.runSpeed}
        visible={(camera, head) => camera.position.distanceTo(head) > 0.45}
        onStood={() => {
          partnerState.seat = null
          st.current.mode = 'follow'
          st.current.seat = null
        }}
      />
    </>
  )
}
