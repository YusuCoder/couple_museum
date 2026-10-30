import { useMemo } from 'react'
import * as THREE from 'three'
import { CuboidCollider, RigidBody } from '@react-three/rapier'

import { FACADE, FACADE_HALF, PLAZA } from './floorplan'
import { Gate } from './Gate'
import { ModernFront } from './ModernFront'
import { foliageTexture, paverTexture } from './textures'

const HALF = FACADE_HALF
const D = FACADE.depth

/**
 * Outside the museum: a plaza of large concrete slabs closed in by hedges,
 * lawn beyond, and the building's modern front with its double door.
 */
export function Exterior({ length }: { length: number }) {
  const m = useMemo(() => {
    const paver = paverTexture()
    paver.repeat.set((2 * PLAZA.halfWidth) / 6, PLAZA.depth / 6) // 1.2 m slabs
    const grass = foliageTexture('#4f6b36')
    grass.repeat.set(60, 60)
    const hedge = foliageTexture('#2f4a24')
    hedge.repeat.set(8, 1)
    return {
      paver: new THREE.MeshStandardMaterial({ map: paver, roughness: 0.85 }),
      grass: new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }),
      hedge: new THREE.MeshStandardMaterial({ map: hedge, roughness: 1 }),
    }
  }, [])

  // Cross-hedges meet the ends of the facade so the plaza is closed
  const facadeEnd = HALF + 0.3

  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[PLAZA.halfWidth, 0.1, PLAZA.depth / 2]} position={[0, -0.1, PLAZA.depth / 2]} />
        <Hedge from={[-PLAZA.halfWidth, D]} to={[-PLAZA.halfWidth, PLAZA.depth]} material={m.hedge} />
        <Hedge from={[PLAZA.halfWidth, D]} to={[PLAZA.halfWidth, PLAZA.depth]} material={m.hedge} />
        <Hedge from={[-PLAZA.halfWidth, PLAZA.depth]} to={[PLAZA.halfWidth, PLAZA.depth]} material={m.hedge} />
        <Hedge from={[-PLAZA.halfWidth, D + 0.5]} to={[-facadeEnd, D + 0.5]} material={m.hedge} />
        <Hedge from={[facadeEnd, D + 0.5]} to={[PLAZA.halfWidth, D + 0.5]} material={m.hedge} />
      </RigidBody>

      <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, PLAZA.depth / 2 + D / 2]} material={m.paver}>
        <planeGeometry args={[PLAZA.halfWidth * 2, PLAZA.depth - D]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} material={m.grass}>
        <planeGeometry args={[400, 400]} />
      </mesh>

      <ModernFront length={length} />
      <Gate />
    </>
  )
}

/** Clipped box hedge between two points on an axis-aligned line. */
function Hedge({ from, to, material }: { from: [number, number]; to: [number, number]; material: THREE.Material }) {
  const [x1, z1] = from
  const [x2, z2] = to
  const alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1)
  const size: [number, number, number] = alongX ? [Math.abs(x2 - x1), 1.1, 0.9] : [0.9, 1.1, Math.abs(z2 - z1)]
  const pos: [number, number, number] = [(x1 + x2) / 2, 0.55, (z1 + z2) / 2]
  return (
    <>
      <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} position={pos} />
      <mesh position={pos} material={material}>
        <boxGeometry args={size} />
      </mesh>
    </>
  )
}
