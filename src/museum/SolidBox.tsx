import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { CuboidCollider } from '@react-three/rapier'

import { occluders } from './store'

/**
 * A solid box of building: visible, walk-proof (collider) and opaque to the
 * look-at ray. Must be rendered inside a fixed <RigidBody>. `material` can be
 * one material or six (+x, -x, +y, -y, +z, -z faces).
 */
export function SolidBox({
  position,
  size,
  material,
  rotationY = 0,
  occludes = true,
}: {
  position: [number, number, number]
  size: [number, number, number]
  material: THREE.Material | THREE.Material[]
  /** Turn about the vertical axis (curved walls are built from rotated segments). */
  rotationY?: number
  occludes?: boolean
}) {
  const mesh = useRef<THREE.Mesh>(null)
  useEffect(() => {
    if (!occludes) return
    const m = mesh.current!
    occluders.add(m)
    return () => {
      occluders.delete(m)
    }
  }, [occludes])
  return (
    <>
      <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} position={position} rotation={[0, rotationY, 0]} />
      <mesh ref={mesh} position={position} rotation-y={rotationY} material={material}>
        <boxGeometry args={size} />
      </mesh>
    </>
  )
}

/** Six-face material list for a wall with different finishes on its front (+z) and back (-z). */
export const faces = (sides: THREE.Material, front: THREE.Material, back: THREE.Material) => [
  sides,
  sides,
  sides,
  sides,
  front,
  back,
]
