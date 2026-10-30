import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'

import { audio } from './audio'
import { DoorLeaf, swing } from './Doors'
import { FACADE, GATE } from './floorplan'
import { playerState } from './Player'
import { useMuseum } from './store'

const LEAF_W = GATE.width / 2
const LEAF_H = GATE.height - 0.05
const OPEN_ANGLE = THREE.MathUtils.degToRad(102)
const OPEN_SECONDS = 2.8
const HINGE_Z = FACADE.depth / 2
/** How close (m) the visitor must be to open the door. */
const REACH = 4.5

/**
 * The big front door: two tall dark-green metal leaves with brass pull bars,
 * hinged at the sides of the opening.
 * E (or a click) when close swings them inward with a creak and a thud.
 */
export function Gate() {
  const gate = useMuseum((s) => s.gate)
  const left = useRef<THREE.Group>(null)
  const right = useRef<THREE.Group>(null)
  const progress = useRef(0)
  const startedSound = useRef(false)

  useFrame((_, dt) => {
    const s = useMuseum.getState()
    // Offer the door when the visitor is outside and close to it
    const p = playerState.position
    const near = s.gate === 'closed' && p.z > 0 && Math.hypot(p.x, p.z - FACADE.depth) < REACH
    if (near !== s.nearGate) s.set({ nearGate: near })

    if (s.gate === 'closed') return
    if (!startedSound.current) {
      startedSound.current = true
      audio().doorOpen(OPEN_SECONDS)
    }
    progress.current = Math.min(progress.current + dt / OPEN_SECONDS, 1)
    const a = swing(progress.current) * OPEN_ANGLE
    if (left.current) left.current.rotation.y = a
    if (right.current) right.current.rotation.y = -a
    if (progress.current >= 1 && s.gate === 'opening') s.set({ gate: 'open' })
  })

  return (
    <>
      {([-1, 1] as const).map((side) => (
        <group key={side} ref={side < 0 ? left : right} position={[side * GATE.width / 2, 0, HINGE_Z]}>
          <DoorLeaf side={side} width={LEAF_W} height={LEAF_H} />
        </group>
      ))}

      {/* Closed: the doorway is blocked. Open: the leaves rest against the inside wall. */}
      <RigidBody type="fixed" colliders={false}>
        {gate !== 'open' ? (
          <CuboidCollider args={[GATE.width / 2, GATE.height / 2, 0.2]} position={[0, GATE.height / 2, HINGE_Z]} />
        ) : (
          [-1, 1].map((side) => {
            const hinge = new THREE.Vector3(side * GATE.width / 2, 0, HINGE_Z)
            // Same rotation as the leaf meshes: inward, towards -z
            const dir = new THREE.Vector3(-side, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), -side * OPEN_ANGLE)
            const mid = hinge.clone().addScaledVector(dir, LEAF_W / 2)
            return (
              <CuboidCollider
                key={side}
                args={[0.12, LEAF_H / 2, LEAF_W / 2]}
                position={[mid.x, LEAF_H / 2, mid.z]}
              />
            )
          })
        )}
      </RigidBody>
    </>
  )
}
