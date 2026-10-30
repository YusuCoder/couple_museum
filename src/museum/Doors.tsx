import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'

import { audio } from './audio'
import { DOORWAY, WALL } from './floorplan'
import { playerState } from './Player'
import { everyone, hearing, shareWorld } from './presence'
import { occluders, useMuseum, type DoorState } from './store'

/**
 * Door finishes: the front door in the gallery's dark green metal; doors
 * between rooms in a pale warm lacquer so they read against the dark walls.
 * Brass pulls on both.
 */
const FINISHES = {
  green: {
    slab: new THREE.MeshStandardMaterial({ color: '#2f3b34', metalness: 0.55, roughness: 0.38 }),
    reveal: new THREE.MeshStandardMaterial({ color: '#141a16', roughness: 0.6 }),
  },
  ivory: {
    slab: new THREE.MeshStandardMaterial({ color: '#e6dfd3', metalness: 0.05, roughness: 0.42 }),
    reveal: new THREE.MeshStandardMaterial({ color: '#a89d8d', roughness: 0.6 }),
  },
}
const brass = new THREE.MeshStandardMaterial({ color: '#c9a35a', metalness: 0.9, roughness: 0.3 })

/** Heavy door swing: slow to get going, then a long glide to a soft stop (ease-in-out cubic). */
export function swing(t: number) {
  const x = THREE.MathUtils.clamp(t, 0, 1)
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2
}

/**
 * One door leaf, drawn from its hinge (the parent's origin) towards the middle
 * of the opening. `side` is -1 for the left leaf, 1 for the right. While
 * mounted it blocks the look-at ray (no focusing on pictures through a door).
 */
export function DoorLeaf({
  side,
  width,
  height,
  thickness = 0.12,
  finish = 'green',
}: {
  side: -1 | 1
  width: number
  height: number
  thickness?: number
  finish?: keyof typeof FINISHES
}) {
  const slab = useRef<THREE.Mesh>(null)
  useEffect(() => {
    const m = slab.current!
    occluders.add(m)
    return () => {
      occluders.delete(m)
    }
  }, [])
  const m = { ...FINISHES[finish], brass }
  return (
    <group position-x={-side * width / 2}>
      <mesh ref={slab} position-y={height / 2} material={m.slab}>
        <boxGeometry args={[width - 0.01, height, thickness]} />
      </mesh>
      {/* Fine horizontal reveals and a long brass pull bar, on both faces */}
      {[1, -1].map((face) => (
        <group key={face} position-z={face * (thickness / 2 + 0.002)}>
          {[height * 0.33, height * 0.66].map((y) => (
            <mesh key={y} position-y={y} material={m.reveal}>
              <boxGeometry args={[width - 0.01, 0.012, 0.004]} />
            </mesh>
          ))}
          <mesh position={[-side * (width / 2 - 0.2), 1.45, face * 0.07]} material={m.brass}>
            <cylinderGeometry args={[0.022, 0.022, Math.min(1.9, height - 0.9), 12]} />
          </mesh>
          {[0.6, Math.min(2.3, height - 0.5)].map((y) => (
            <mesh key={y} position={[-side * (width / 2 - 0.2), y, face * 0.035]} rotation-x={Math.PI / 2} material={m.brass}>
              <cylinderGeometry args={[0.012, 0.012, 0.07, 8]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- doors between rooms

const LEAF_W = DOORWAY.width / 2
const LEAF_H = DOORWAY.height - 0.02
const LEAF_T = 0.08
const OPEN_ANGLE = THREE.MathUtils.degToRad(95)
const OPEN_SECONDS = 2.2
const CLOSE_SECONDS = 2.6
/** Offered when the visitor is this close (m); swings shut once they are this far away. */
const REACH = 3.6
const CLOSE_AFTER = 9

const _door = new THREE.Vector3()
const CLOSED: DoorState = { state: 'closed', dir: -1 }

/** World z of each doorway's door, by index (door k joins room k and room k+1). */
const doorZ = new Map<number, number>()

/** Open the door the visitor is standing at, swinging it away from them. */
export function openNearDoor() {
  const s = useMuseum.getState()
  if (!s.nearDoor) return false
  const { index } = s.nearDoor
  const z = doorZ.get(index)
  if (z === undefined) return false
  // Push it away: walking towards -z opens it into the next room, and back again the other way
  const dir: -1 | 1 = playerState.position.z > z ? -1 : 1
  s.set({ doors: { ...s.doors, [index]: { state: 'opening', dir } }, nearDoor: null })
  shareWorld({ kind: 'door', index, state: 'opening', dir })
  return true
}

/**
 * The door in the doorway between room `index` and room `index + 1`, at world
 * z. Opens with E when near, closes by itself once the visitor has moved on.
 */
export function InteriorDoor({ index, z, forward, back }: { index: number; z: number; forward: string; back: string }) {
  const door = useMuseum((s) => s.doors[index] ?? CLOSED)
  const left = useRef<THREE.Group>(null)
  const right = useRef<THREE.Group>(null)
  const progress = useRef(door.state === 'open' ? 1 : 0)
  const sounded = useRef<DoorState['state']>(door.state)

  useEffect(() => {
    doorZ.set(index, z)
    return () => {
      doorZ.delete(index)
      const s = useMuseum.getState()
      if (s.nearDoor?.index === index) s.set({ nearDoor: null })
    }
  }, [index, z])

  useFrame((_, dt) => {
    const s = useMuseum.getState()
    const d = s.doors[index] ?? CLOSED
    const p = playerState.position
    const dist = Math.hypot(p.x, p.z - z)

    // Offer the door, naming the chapter on the other side
    const near = d.state === 'closed' && dist < REACH && s.mode === 'walking'
    if (near && s.nearDoor?.index !== index) s.set({ nearDoor: { index, label: p.z > z ? forward : back } })
    else if (!near && s.nearDoor?.index === index) s.set({ nearDoor: null })

    const volume = hearing(_door.set(0, 0, z), p)
    if (d.state !== sounded.current) {
      sounded.current = d.state
      if (d.state === 'opening') audio().doorOpen(OPEN_SECONDS, { soft: true, volume })
    }

    // Arrived to find it already open (or shut): no swing
    if (d.state === 'open') progress.current = 1
    else if (d.state === 'closed') progress.current = 0

    if (d.state === 'opening') {
      progress.current = Math.min(progress.current + dt / OPEN_SECONDS, 1)
      if (progress.current >= 1) s.set({ doors: { ...s.doors, [index]: { ...d, state: 'open' } } })
    } else if (
      d.state === 'open' &&
      s.mode === 'walking' &&
      // Swings shut only once everyone has moved on from it
      everyone(p).every((q) => Math.hypot(q.x, q.z - z) > CLOSE_AFTER)
    ) {
      s.set({ doors: { ...s.doors, [index]: { ...d, state: 'closing' } } })
      shareWorld({ kind: 'door', index, state: 'closing', dir: d.dir })
    } else if (d.state === 'closing') {
      progress.current = Math.max(progress.current - dt / CLOSE_SECONDS, 0)
      if (progress.current <= 0) {
        audio().doorClose(volume)
        s.set({ doors: { ...s.doors, [index]: { ...d, state: 'closed' } } })
      }
    }

    // dir -1: leaves swing towards -z (into the next room); +1 back towards the previous one
    const a = swing(progress.current) * OPEN_ANGLE
    if (left.current) left.current.rotation.y = -d.dir * a
    if (right.current) right.current.rotation.y = d.dir * a
  })

  return (
    <>
      {([-1, 1] as const).map((side) => (
        <group key={side} ref={side < 0 ? left : right} position={[side * LEAF_W, 0, z]}>
          <DoorLeaf side={side} width={LEAF_W} height={LEAF_H} thickness={LEAF_T} finish="ivory" />
        </group>
      ))}

      {/* Closed (or moving): the doorway is blocked. Open: the leaves stand out of the way. */}
      <RigidBody type="fixed" colliders={false}>
        {door.state !== 'open' ? (
          // As thick as the passage: a thin wall is expensive for the walker's continuous collision to lean on
          <CuboidCollider args={[DOORWAY.width / 2, DOORWAY.height / 2, WALL]} position={[0, DOORWAY.height / 2, z]} />
        ) : (
          ([-1, 1] as const).map((side) => {
            const hinge = new THREE.Vector3(side * LEAF_W, 0, z)
            const along = new THREE.Vector3(-side, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), side * door.dir * OPEN_ANGLE)
            const mid = hinge.clone().addScaledVector(along, LEAF_W / 2)
            return <CuboidCollider key={side} args={[0.08, LEAF_H / 2, LEAF_W / 2]} position={[mid.x, LEAF_H / 2, mid.z]} />
          })
        )}
      </RigidBody>
    </>
  )
}
