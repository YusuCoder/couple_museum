import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Sparkles, Stars } from '@react-three/drei'

/**
 * The plaza at night: a deep blue sky with stars and a big soft moon, beds of
 * flowers, and warm garden lights — lamp posts and strings of bulbs over the
 * path. Every light here is faked (glowing bulbs, halos, pools of light on the
 * ground): real lights are paid for on every pixel of every frame.
 */

/** Where the moon hangs: up and to the left of the front door, as seen from the plaza (clear of the fireworks' message). */
export const MOON_DIR = new THREE.Vector3(-0.85, 0.55, -0.75).normalize()

// ---------------------------------------------------------------- sky

export function NightSky() {
  const sky = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        uniforms: {
          zenith: { value: new THREE.Color('#03050d') },
          horizon: { value: new THREE.Color('#1a2747') },
          glow: { value: new THREE.Color('#2e3d63') },
          moon: { value: MOON_DIR },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 zenith;
          uniform vec3 horizon;
          uniform vec3 glow;
          uniform vec3 moon;
          varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y, 0.0, 1.0);
            vec3 c = mix(horizon, zenith, pow(h, 0.45));
            // Moonlit haze around the moon
            float m = max(dot(normalize(vDir), moon), 0.0);
            c += glow * pow(m, 12.0) * 0.9;
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
    [],
  )

  const halo = useMemo(() => glowTexture(), [])
  const moonPos = MOON_DIR.clone().multiplyScalar(320)

  return (
    <>
      <mesh material={sky} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[450, 32, 16]} />
      </mesh>
      <Stars radius={260} depth={60} count={2600} factor={5} saturation={0} fade speed={0.4} />
      <group position={moonPos}>
        <mesh>
          <sphereGeometry args={[9, 32, 16]} />
          <meshBasicMaterial color="#fff4dc" toneMapped={false} fog={false} />
        </mesh>
        <sprite scale={[70, 70, 1]}>
          <spriteMaterial map={halo} color="#9fb2dc" transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} fog={false} />
        </sprite>
      </group>
    </>
  )
}

// ---------------------------------------------------------------- flowers

const PETALS = ['#d92b4b', '#f27ca3', '#fff3ee', '#b88ae6', '#ffb35c', '#ff5c7a', '#f7d6e8', '#e6455f']
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _c = new THREE.Color()

/** Small deterministic random, so both visitors' gardens grow the same. */
function seeded(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
}

/**
 * A bed of flowers filling a w × d rectangle: leafy mounds, stems, and
 * blossoms in mixed colours that glow softly in the garden lights.
 */
export function FlowerBed({ width, depth, y = 0, seed = 1 }: { width: number; depth: number; y?: number; seed?: number }) {
  const count = Math.round(width * depth * 13)
  const bushes = Math.round(width * depth * 0.9)
  const blossoms = useRef<THREE.InstancedMesh>(null)
  const stems = useRef<THREE.InstancedMesh>(null)
  const leaves = useRef<THREE.InstancedMesh>(null)

  const m = useMemo(() => {
    const petal = new THREE.MeshStandardMaterial({ roughness: 0.75, emissive: '#ffffff', emissiveIntensity: 0.28 })
    // Each blossom glows in its own colour (instance colour), as if caught by the lamps
    petal.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb;\n#endif',
      )
    }
    return {
      petal,
      stem: new THREE.MeshStandardMaterial({ color: '#3f6b2a', roughness: 1 }),
      leaf: new THREE.MeshStandardMaterial({ color: '#2c4a22', roughness: 1, flatShading: true }),
      blossomGeo: (() => {
        const g = new THREE.IcosahedronGeometry(0.075, 0)
        g.scale(1, 0.7, 1)
        return g
      })(),
      stemGeo: (() => {
        const g = new THREE.CylinderGeometry(0.008, 0.01, 1, 3)
        g.translate(0, 0.5, 0)
        return g
      })(),
      leafGeo: new THREE.IcosahedronGeometry(0.3, 0),
    }
  }, [])

  useLayoutEffect(() => {
    const rand = seeded(seed * 7919)
    const b = blossoms.current!
    const st = stems.current!
    const lf = leaves.current!
    for (let i = 0; i < count; i++) {
      const x = (rand() - 0.5) * (width - 0.25)
      const z = (rand() - 0.5) * (depth - 0.25)
      const h = 0.28 + rand() * 0.42
      const tilt = (rand() - 0.5) * 0.3
      _e.set(tilt, rand() * Math.PI * 2, (rand() - 0.5) * 0.3)
      _q.setFromEuler(_e)
      _m.compose(_p.set(x, y, z), _q, _s.set(1, h, 1))
      st.setMatrixAt(i, _m)
      // The blossom sits at the top of the (slightly leaning) stem
      _p.set(0, h, 0).applyQuaternion(_q).add(_s.set(x, y, z))
      const size = 0.8 + rand() * 0.7
      _m.compose(_p, _q, _s.set(size, size, size))
      b.setMatrixAt(i, _m)
      b.setColorAt(i, _c.set(PETALS[Math.floor(rand() * PETALS.length)]).offsetHSL(0, 0, (rand() - 0.5) * 0.08))
    }
    for (let i = 0; i < bushes; i++) {
      const x = (rand() - 0.5) * (width - 0.4)
      const z = (rand() - 0.5) * (depth - 0.4)
      const s = 0.7 + rand() * 0.8
      _e.set(0, rand() * Math.PI, 0)
      _m.compose(_p.set(x, y + 0.05, z), _q.setFromEuler(_e), _s.set(s, s * 0.55, s))
      lf.setMatrixAt(i, _m)
    }
    for (const mesh of [b, st, lf]) {
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
    if (b.instanceColor) b.instanceColor.needsUpdate = true
  }, [count, bushes, width, depth, y, seed])

  return (
    <>
      <instancedMesh ref={leaves} args={[m.leafGeo, m.leaf, bushes]} />
      <instancedMesh ref={stems} args={[m.stemGeo, m.stem, count]} />
      <instancedMesh ref={blossoms} args={[m.blossomGeo, m.petal, count]} />
      {/* Fireflies drifting over the flowers */}
      <Sparkles count={Math.round(width * depth * 0.4)} scale={[width, 1.6, depth]} position-y={y + 1} size={4} speed={0.25} opacity={0.9} color="#ffe7a0" noise={1.2} />
    </>
  )
}

// ---------------------------------------------------------------- lights

/** Soft round glow, white in the middle fading to nothing (halos and pools of light). */
let glowTex: THREE.Texture | null = null
export function glowTexture() {
  if (glowTex) return glowTex
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  glowTex = new THREE.CanvasTexture(c)
  glowTex.colorSpace = THREE.SRGBColorSpace
  return glowTex
}

const WARM = '#ffc778'
const bulbMaterial = new THREE.MeshBasicMaterial({ color: '#ffe2a8', toneMapped: false })
const poleMaterial = new THREE.MeshStandardMaterial({ color: '#16181a', roughness: 0.45, metalness: 0.6 })
const wireMaterial = new THREE.MeshBasicMaterial({ color: '#0d0d0d' })

/** A warm pool of light on the ground. */
export function GroundGlow({ x, z, radius, strength = 0.5, y = 0.075 }: { x: number; z: number; radius: number; strength?: number; y?: number }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[x, y, z]} renderOrder={1}>
      <planeGeometry args={[radius * 2, radius * 2]} />
      <meshBasicMaterial map={glowTexture()} color={WARM} transparent opacity={strength} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  )
}

/** A glowing point of light: the bulb itself and the halo around it. */
function Bulb({ position, size = 0.06, halo = 0.7, intensity = 0.8 }: { position: [number, number, number]; size?: number; halo?: number; intensity?: number }) {
  return (
    <group position={position}>
      <mesh material={bulbMaterial}>
        <sphereGeometry args={[size, 10, 8]} />
      </mesh>
      <sprite scale={[halo, halo, 1]}>
        <spriteMaterial map={glowTexture()} color={WARM} transparent opacity={intensity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
    </group>
  )
}

export const LAMP_HEIGHT = 3.6

/** A slim black garden lamp post with a glowing globe and a pool of light at its feet. */
export function LampPost({ x, z }: { x: number; z: number }) {
  return (
    <group>
      <mesh position={[x, LAMP_HEIGHT / 2, z]} material={poleMaterial}>
        <cylinderGeometry args={[0.05, 0.08, LAMP_HEIGHT, 10]} />
      </mesh>
      <Bulb position={[x, LAMP_HEIGHT + 0.18, z]} size={0.2} halo={2.4} intensity={0.9} />
      <GroundGlow x={x} z={z} radius={4.5} strength={0.55} />
    </group>
  )
}

/** A string of bulbs hanging between two points, sagging in the middle. */
export function StringLights({ from, to, sag = 1, spacing = 1.3 }: { from: [number, number, number]; to: [number, number, number]; sag?: number; spacing?: number }) {
  const { points, wire } = useMemo(() => {
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    const at = (t: number) => a.clone().lerp(b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0))
    const n = Math.max(2, Math.round(a.distanceTo(b) / spacing))
    const points: [number, number, number][] = []
    for (let i = 1; i < n; i++) {
      const p = at(i / n)
      points.push([p.x, p.y - 0.09, p.z])
    }
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 17 }, (_, i) => at(i / 16)))
    return { points, wire: new THREE.TubeGeometry(curve, 48, 0.008, 4) }
  }, [from, to, sag, spacing])

  return (
    <>
      <mesh geometry={wire} material={wireMaterial} />
      {points.map((p, i) => (
        <Bulb key={i} position={p} />
      ))}
    </>
  )
}
