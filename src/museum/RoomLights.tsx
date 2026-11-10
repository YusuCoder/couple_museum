import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

import { GATE, DOORWAY } from './floorplan'
import { playerState } from './Player'
import { everyone } from './presence'

/** How dark a room is before anyone has walked in (share of its light left), and how its lights come up. */
const DARK = 0.004
/** A step past the doorway counts as walking in. */
const IN = 0.5
const DELAY = 0.4
const FADE = 4

/**
 * Each room waits in the dark until someone — either visitor — walks in
 * through its door, then its lights slowly come up. Drawn as a sheet across the
 * doorway that darkens everything seen through it — and, should someone step
 * in before the lights are fully up, a sheet over their view instead — so the
 * room's own lights and materials stay untouched. Once lit, a room stays lit.
 */
export function RoomLights({
  door,
  z,
  inside,
}: {
  /** The interior door that opens on to this room; null: the front door. */
  door: number | null
  /** The doorway's plane (world z); the room lies towards -z. */
  z: number
  /** Where the room ends (world z) and its half width. */
  inside: { far: number; half: number }
}) {
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(DARK, DARK, DARK),
        transparent: true,
        // out = what's behind × colour
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.ZeroFactor,
        blendDst: THREE.SrcColorFactor,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
    [],
  )
  const overlay = useMemo(() => {
    const m = material.clone()
    m.depthTest = false
    return m
  }, [material])
  const sheet = useRef<THREE.Mesh>(null)
  const cover = useRef<THREE.Mesh>(null)
  const st = useRef({ openedAt: -1, level: 0 })
  const fwd = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ camera, clock }) => {
    const s = st.current
    if (s.level >= 1) return
    if (s.openedAt < 0) {
      const entered = everyone(playerState.position).some((p) => p.z < z - IN && p.z > inside.far && Math.abs(p.x) < inside.half)
      if (entered) s.openedAt = clock.elapsedTime
    }
    const t = s.openedAt < 0 ? 0 : THREE.MathUtils.clamp((clock.elapsedTime - s.openedAt - DELAY) / FADE, 0, 1)
    // Lamps warming up: slow to start, easing in at the end
    s.level = t * t * (3 - 2 * t)
    const k = DARK + (1 - DARK) * s.level
    material.color.setRGB(k, k, k)
    overlay.color.setRGB(k, k, k)

    const c = camera.position
    const within = c.z < z && c.z > inside.far && Math.abs(c.x) < inside.half
    if (sheet.current) sheet.current.visible = s.level < 1 && !within
    if (cover.current) {
      cover.current.visible = s.level < 1 && within
      if (within) {
        camera.getWorldDirection(fwd)
        cover.current.position.copy(c).addScaledVector(fwd, 0.1)
        cover.current.quaternion.copy(camera.quaternion)
      }
    }
  })

  const [w, h] = door === null ? [GATE.width, GATE.height] : [DOORWAY.width, DOORWAY.height]
  return (
    <>
      <mesh ref={sheet} position={[0, h / 2, z]} material={material} renderOrder={1000}>
        <planeGeometry args={[w + 0.1, h + 0.05]} />
      </mesh>
      <mesh ref={cover} material={overlay} renderOrder={1001} frustumCulled={false} visible={false}>
        <planeGeometry args={[2, 2]} />
      </mesh>
    </>
  )
}
