import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

/**
 * Fake spotlight: the warm oval of light a ceiling spot throws on a wall,
 * drawn as a decal that brightens the wall *in its own colour*
 * (result = wall × (1 + light)), like real light does — so it reads right on
 * white and on dark green walls alike. Costs nothing elsewhere; real
 * SpotLights were ~5 ms each per frame on a Retina screen.
 */
let poolTexture: THREE.Texture | null = null
function getPoolTexture() {
  if (poolTexture) return poolTexture
  const w = 256
  const h = 512
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  // Slightly tall ellipse that fits inside the texture: rounded top (penumbra),
  // long soft fade towards the floor
  ctx.save()
  ctx.translate(w / 2, h * 0.36)
  ctx.scale(1, 1.4)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.8)')
  g.addColorStop(0.8, 'rgba(255,255,255,0.3)')
  g.addColorStop(0.97, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(-w / 2, -h, w, h * 2)
  ctx.restore()
  // Soften the bottom so the pool fades out down the wall
  ctx.globalCompositeOperation = 'destination-in'
  const fade = ctx.createLinearGradient(0, 0, 0, h)
  fade.addColorStop(0, 'rgba(0,0,0,1)')
  fade.addColorStop(0.55, 'rgba(0,0,0,1)')
  fade.addColorStop(1, 'rgba(0,0,0,0.15)')
  ctx.fillStyle = fade
  ctx.fillRect(0, 0, w, h)
  poolTexture = new THREE.CanvasTexture(c)
  return poolTexture
}

export function LightPool({
  width,
  height,
  y = 0,
  z = 0.004,
  strength = 1.1,
  color = '#ffcf94',
  boost,
  curve,
}: {
  width: number
  height: number
  /** Vertical offset of the pool's centre from the parent origin. */
  y?: number
  z?: number
  strength?: number
  color?: string
  /** Called each frame; return true to brighten the pool (e.g. exhibit in focus). */
  boost?: () => boolean
  /**
   * Concave wall (the rotunda): the pool bends to follow it instead of being a
   * flat sheet the curve would hide. `axisZ` is the local z of the wall's
   * centre of curvature, `radius` the wall's radius.
   */
  curve?: { axisZ: number; radius: number }
}) {
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: getPoolTexture(),
        color,
        transparent: true,
        opacity: strength,
        // out = wall + wall × light — light scales with the wall's own colour
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.DstColorFactor,
        blendDst: THREE.OneFactor,
        premultipliedAlpha: true, // fold the oval's alpha into rgb before blending
        depthWrite: false,
        toneMapped: false,
        // A curved pool is seen from inside the cylinder
        side: curve ? THREE.DoubleSide : THREE.FrontSide,
      }),
    [color, strength, curve],
  )
  const target = useRef(strength)

  useFrame((_, dt) => {
    if (!boost) return
    target.current = boost() ? strength * 1.45 : strength
    material.opacity += (target.current - material.opacity) * (1 - Math.exp(-dt * 5))
  })

  if (curve) {
    const r = curve.radius - 0.004
    const half = width / 2 / r
    return (
      <mesh position={[0, y, curve.axisZ]} material={material} renderOrder={-1}>
        {/* An arc of an open cylinder, centred on the side facing the wall (-z) */}
        <cylinderGeometry args={[r, r, height, 48, 1, true, Math.PI - half, half * 2]} />
      </mesh>
    )
  }

  return (
    <mesh position={[0, y, z]} material={material} renderOrder={-1}>
      <planeGeometry args={[width, height]} />
    </mesh>
  )
}
