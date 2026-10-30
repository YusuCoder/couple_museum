import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

import { playerState } from './Player'

/**
 * The Skylight room's touches: a soft beam falling through the round skylight,
 * the warm circle it makes on the floor, and petals drifting down through it.
 * All cheap: additive sprites and one particle system, no lights.
 */

const BEAM_OPACITY = 0.065
const GLOW_OPACITY = 0.22

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/**
 * Romantic hush: stepping into the circle of light slowly dims the building
 * to a warm glow, leaving the beam, the petals and the films bright. Only
 * light intensities and colours change (never materials or effects), so it
 * costs nothing and can't hitch. `value` is eased by the light rig.
 */
export const romance = {
  value: 0,
  /** Skylight rooms whose circle the visitor is standing in. */
  inside: new Set<object>(),
  /** Centre (on the floor) of the circle being stood in: where the spotlight falls. */
  centre: new THREE.Vector3(),
  /** Seconds to dim fully, and to come back up. */
  dimSeconds: 4.5,
  brightenSeconds: 2.5,
}

/** 0..1, eased (slow at both ends). */
export const romanceLevel = () => THREE.MathUtils.smoothstep(romance.value, 0, 1)

/** Watches the circle of light around this room's centre and dims the dome with the rest. */
export function Romance({ radius, dome }: { radius: number; dome: THREE.MeshStandardMaterial }) {
  const ref = useRef<THREE.Group>(null)
  const key = useMemo(() => ({}), [])
  const centre = useMemo(() => new THREE.Vector3(), [])
  const base = useMemo(() => (dome.userData.baseEmissive ??= dome.emissiveIntensity) as number, [dome])

  useFrame(() => {
    if (!ref.current) return
    ref.current.getWorldPosition(centre)
    const p = playerState.position
    if (Math.hypot(p.x - centre.x, p.z - centre.z) < radius) {
      romance.inside.add(key)
      romance.centre.copy(centre)
    } else romance.inside.delete(key)
    dome.emissiveIntensity = base * (1 - 0.72 * romanceLevel())
  })
  useEffect(
    () => () => {
      romance.inside.delete(key)
    },
    [key],
  )
  return <group ref={ref} />
}

/** A cone of hazy light from the skylight down to the floor: strongest at the top, fading out. */
export function LightBeam({ top, bottom, height, y0 = 0 }: { top: number; bottom: number; height: number; y0?: number }) {
  const material = useMemo(() => {
    const map = canvasTex(4, 256, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 256)
      g.addColorStop(0, 'rgba(255,255,255,0.85)')
      g.addColorStop(0.4, 'rgba(255,255,255,0.3)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 4, 256)
    })
    map.colorSpace = THREE.NoColorSpace
    map.flipY = true
    return new THREE.MeshBasicMaterial({
      color: '#fff1da',
      alphaMap: map,
      transparent: true,
      opacity: BEAM_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
  }, [])
  // From inside the cone, its far side would veil the whole view: fade it while the camera is in there
  const mesh = useRef<THREE.Mesh>(null)
  const axis = useMemo(() => new THREE.Vector3(), [])
  const fade = useRef(1)
  useFrame(({ camera }, dt) => {
    if (!mesh.current) return
    mesh.current.getWorldPosition(axis)
    const along = THREE.MathUtils.clamp((camera.position.y - y0) / height, 0, 1)
    const r = THREE.MathUtils.lerp(bottom, top, along)
    const inside = Math.hypot(camera.position.x - axis.x, camera.position.z - axis.z) < r + 0.4
    fade.current += ((inside ? 0.35 : 1) - fade.current) * (1 - Math.exp(-dt * 4))
    // ...and thin it as the room dims, so it doesn't grey out the couple standing in it
    material.opacity = BEAM_OPACITY * fade.current * (1 - 0.55 * romanceLevel())
  })
  return (
    <mesh ref={mesh} position-y={y0 + height / 2} material={material} renderOrder={2}>
      <cylinderGeometry args={[top, bottom, height, 48, 1, true]} />
    </mesh>
  )
}

/** The warm circle the beam leaves on the floor. */
export function FloorGlow({ radius }: { radius: number }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(() => {
    if (mat.current) mat.current.opacity = GLOW_OPACITY * (1 + 0.45 * romanceLevel())
  })
  const map = useMemo(
    () =>
      canvasTex(256, 256, (ctx) => {
        const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
        g.addColorStop(0, 'rgba(255,255,255,1)')
        g.addColorStop(0.65, 'rgba(255,255,255,0.75)')
        g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, 256, 256)
      }),
    [],
  )
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.02} renderOrder={1}>
      <circleGeometry args={[radius, 64]} />
      <meshBasicMaterial ref={mat} map={map} color="#ffe2b8" transparent opacity={GLOW_OPACITY} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

/** Rose and cream petals drifting slowly down, mostly through the beam; each one turns as it falls. */
export function Petals({ count = 70, spread = 4.2, height = 6.5 }: { count?: number; spread?: number; height?: number }) {
  const ref = useRef<THREE.ShaderMaterial>(null)

  const { geometry, map } = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3)
    const seed = new Float32Array(count)
    let s = 7654321
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2
      const r = Math.sqrt(rand()) * spread
      pos.set([Math.sin(a) * r, rand() * height, Math.cos(a) * r], i * 3)
      seed[i] = rand() * 100
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1))
    // One petal: a soft teardrop with a paler centre line
    const petal = canvasTex(64, 64, (ctx) => {
      ctx.translate(32, 32)
      const grad = ctx.createLinearGradient(0, -26, 0, 26)
      grad.addColorStop(0, '#ffffff')
      grad.addColorStop(1, '#d9d9d9')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.moveTo(0, -26)
      ctx.bezierCurveTo(22, -14, 18, 18, 0, 26)
      ctx.bezierCurveTo(-18, 18, -22, -14, 0, -26)
      ctx.fill()
    })
    return { geometry: g, map: petal }
  }, [count, spread, height])

  useFrame(({ clock }) => {
    if (ref.current) ref.current.uniforms.uTime.value = clock.elapsedTime
  })

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={ref}
        transparent
        depthWrite={false}
        uniforms={{ uTime: { value: 0 }, uMap: { value: map }, uHeight: { value: height } }}
        vertexShader={/* glsl */ `
          uniform float uTime;
          uniform float uHeight;
          attribute float seed;
          varying float vSeed;
          varying float vFade;
          void main() {
            vSeed = seed;
            vec3 p = position;
            // fall ~0.25 m/s, wrapping back to the top; drift and flutter sideways
            float fall = mod(p.y - uTime * (0.18 + fract(seed) * 0.14), uHeight);
            p.y = fall;
            p.x += sin(uTime * 0.6 + seed) * 0.35 + sin(uTime * 1.7 + seed * 3.0) * 0.06;
            p.z += cos(uTime * 0.5 + seed * 1.3) * 0.35;
            vFade = smoothstep(0.0, 0.4, fall) * smoothstep(uHeight, uHeight - 0.8, fall);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = (95.0 + fract(seed * 7.0) * 50.0) / -mv.z;
            gl_Position = projectionMatrix * mv;
          }
        `}
        fragmentShader={/* glsl */ `
          uniform sampler2D uMap;
          uniform float uTime;
          varying float vSeed;
          varying float vFade;
          void main() {
            // turn the petal as it falls (flip = squash across one axis)
            float a = uTime * (0.8 + fract(vSeed) * 1.2) + vSeed;
            vec2 uv = gl_PointCoord - 0.5;
            uv = mat2(cos(a), -sin(a), sin(a), cos(a)) * uv;
            uv.x /= max(abs(sin(a * 0.7 + vSeed)), 0.25);
            uv += 0.5;
            if (uv.x < 0.0 || uv.x > 1.0) discard;
            vec4 t = texture2D(uMap, uv);
            if (t.a < 0.1) discard;
            vec3 rose = vec3(0.86, 0.42, 0.50);
            vec3 blush = vec3(0.96, 0.72, 0.74);
            vec3 cream = vec3(0.98, 0.92, 0.84);
            float k = fract(vSeed * 3.17);
            vec3 col = (k < 0.45 ? rose : k < 0.8 ? blush : cream) * t.rgb;
            gl_FragColor = vec4(col, t.a * vFade * 0.95);
          }
        `}
      />
    </points>
  )
}
