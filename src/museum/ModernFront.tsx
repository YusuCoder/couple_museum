import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier'

import { BUILDING_HALF_WIDTH, FACADE, FACADE_HALF, GATE } from './floorplan'
import { LightPool } from './LightPool'
import { FlowerBed, GroundGlow, LAMP_HEIGHT, LampPost, StringLights } from './Night'
import { wallMaterial } from './Room'
import { SolidBox, faces } from './SolidBox'
import { useMuseum } from './store'
import { brassLettersTexture, concreteTexture, facadeConcreteTexture, foliageTexture } from './textures'

const HALF = FACADE_HALF
const D = FACADE.depth
const FH = FACADE.height
const FLANK_X = BUILDING_HALF_WIDTH + 0.2

/** Glazed entrance bay: the door with two tall glass panels either side. */
const PANE = { w: 1.3, h: GATE.height }
const FRAME = 0.12
const PANE_X = [GATE.width / 2 + FRAME + PANE.w / 2, GATE.width / 2 + FRAME * 2 + PANE.w * 1.5]
const BAY_HALF = PANE_X[1] + PANE.w / 2 + FRAME
const CANOPY = { y: 5.3, depth: 4.2, width: 11.5, t: 0.22 }
/** Raised flower beds either side of the entry path (where reflecting pools once were). */
const POOL = { x1: 2.6, x2: 12.5, z1: 7, z2: 18, rim: 0.32, rimT: 0.3 }

function concrete(width: number, height: number) {
  const t = facadeConcreteTexture()
  t.repeat.set(Math.max(width / 4, 0.25), Math.max(height / 4, 0.25))
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 })
}

/**
 * Contemporary front in the language of the galleries inside: a quiet
 * board-marked concrete volume, a glowing glass entrance bay under a thin
 * cantilevered canopy, brass lettering, the gallery's dark green on the doors,
 * bronze fins on one wing, and flower beds under garden lights either side of the path.
 */
export function ModernFront({ length }: { length: number }) {
  const names = useMuseum((s) => s.names)
  const since = useMuseum((s) => s.since)
  const wingW = HALF - GATE.width / 2

  const m = useMemo(() => {
    const cypress = foliageTexture('#26391f')
    cypress.repeat.set(2, 4)
    return {
      wing: concrete(wingW, FH),
      top: concrete(GATE.width, FH - GATE.height),
      flank: concrete(length, FH),
      rim: concrete(2, 0.5),
      // Smooth paving concrete for the path (the facade's board marks and tie holes would stretch)
      path: (() => {
        const t = concreteTexture()
        t.repeat.set(1, 4)
        return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, color: '#efe9e0' })
      })(),
      soffit: new THREE.MeshStandardMaterial({ color: '#e9e4dc', roughness: 0.85 }),
      black: new THREE.MeshStandardMaterial({ color: '#16181a', roughness: 0.4, metalness: 0.6 }),
      bronze: new THREE.MeshStandardMaterial({ color: '#4a3a2b', roughness: 0.45, metalness: 0.75 }),
      // Dark glazing glowing warm from the lobby behind: brightest low and in the middle
      glass: new THREE.MeshStandardMaterial({
        color: '#14120f',
        emissive: '#ffcf96',
        emissiveMap: glazingGlow(),
        emissiveIntensity: 1.25,
        roughness: 0.06,
        metalness: 0.35,
      }),
      slot: new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffcf8f', emissiveIntensity: 1.6, toneMapped: false }),
      strip: new THREE.MeshStandardMaterial({ color: '#000', emissive: '#fff1db', emissiveIntensity: 2.4, toneMapped: false }),
      cypress: new THREE.MeshStandardMaterial({ map: cypress, roughness: 1 }),
      groundCover: (() => {
        const t = foliageTexture('#26401d')
        t.repeat.set(6, 6)
        return new THREE.MeshStandardMaterial({ map: t, roughness: 1 })
      })(),
      trunk: new THREE.MeshStandardMaterial({ color: '#3b2d22', roughness: 1 }),
    }
  }, [wingW, length])

  const letters = useMemo(
    () =>
      brassLettersTexture([
        { text: 'OUR STORY', size: 190, spacing: 46, weight: 500 },
        { text: [names, since && `since ${since}`].filter(Boolean).join('  ·  '), size: 70, italic: true },
      ]),
    [names, since],
  )

  const fins = useMemo(() => {
    const out: [number, number, number][] = []
    for (let x = BAY_HALF + 1.4; x <= HALF - 0.5; x += 0.42) out.push([x, FH / 2 - 0.1, D + 0.25])
    return out
  }, [])

  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        {/* The volume: concrete outside, gallery plaster inside */}
        <SolidBox position={[-(GATE.width / 2 + wingW / 2), FH / 2, D / 2]} size={[wingW, FH, D]} material={faces(m.wing, m.wing, wallMaterial)} />
        <SolidBox position={[GATE.width / 2 + wingW / 2, FH / 2, D / 2]} size={[wingW, FH, D]} material={faces(m.wing, m.wing, wallMaterial)} />
        <SolidBox position={[0, (GATE.height + FH) / 2, D / 2]} size={[GATE.width, FH - GATE.height, D]} material={faces(m.top, m.top, wallMaterial)} />
        {[-1, 1].map((s) => (
          <SolidBox key={s} position={[s * FLANK_X, FH / 2, -length / 2]} size={[0.4, FH, length]} material={m.flank} occludes={false} />
        ))}

        {/* Canopy columns */}
        {[-1, 1].map((s) => (
          <CylinderCollider key={s} args={[CANOPY.y / 2, 0.12]} position={[s * (CANOPY.width / 2 - 0.4), CANOPY.y / 2, D + CANOPY.depth - 0.35]} />
        ))}

        {/* Planter rims (you walk around the flowers, not through them) */}
        {[-1, 1].map((s) => (
          <CuboidCollider
            key={s}
            args={[(POOL.x2 - POOL.x1) / 2, POOL.rim / 2, (POOL.z2 - POOL.z1) / 2]}
            position={[s * (POOL.x1 + POOL.x2) / 2, POOL.rim / 2, (POOL.z1 + POOL.z2) / 2]}
          />
        ))}

        {/* Cypresses */}
        {CYPRESSES.map(([x, z]) => (
          <CylinderCollider key={`${x},${z}`} args={[1.5, 0.45]} position={[x, 1.5, z]} />
        ))}

        {LAMPS.map(([x, z]) => (
          <CylinderCollider key={`l${x},${z}`} args={[LAMP_HEIGHT / 2, 0.1]} position={[x, LAMP_HEIGHT / 2, z]} />
        ))}

        {/* Bollards along the path */}
        {BOLLARDS.map(([x, z]) => (
          <CuboidCollider key={`${x},${z}`} args={[0.1, 0.4, 0.1]} position={[x, 0.4, z]} />
        ))}
      </RigidBody>

      {/* Thin dark coping along the roofline */}
      <mesh position={[0, FH + 0.08, D / 2 + 0.03]} material={m.black}>
        <boxGeometry args={[HALF * 2 + 0.12, 0.16, D + 0.12]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * FLANK_X, FH + 0.08, -length / 2]} material={m.black}>
          <boxGeometry args={[0.46, 0.16, length]} />
        </mesh>
      ))}

      {/* Glazed entrance bay with a black steel frame */}
      <group position-z={D}>
        {[-1, 1].flatMap((s) =>
          PANE_X.map((x) => (
            <mesh key={`${s}${x}`} position={[s * x, PANE.h / 2, 0.02]} material={m.glass}>
              <planeGeometry args={[PANE.w, PANE.h]} />
            </mesh>
          )),
        )}
        {/* Mullions, posts and head */}
        {[-1, 1].flatMap((s) =>
          // Frame sits fully in front of the wall (z > 0) and its door posts stand 2 cm into
          // the opening, so no face shares a plane with the wall (no flicker)
          [GATE.width / 2 + FRAME / 2 - 0.02, PANE_X[0] + PANE.w / 2 + FRAME / 2, BAY_HALF - FRAME / 2].map((x) => (
            <mesh key={`${s}m${x}`} position={[s * x, PANE.h / 2, 0.08]} material={m.black}>
              <boxGeometry args={[FRAME, PANE.h, 0.14]} />
            </mesh>
          )),
        )}
        <mesh position={[0, PANE.h + 0.13, 0.09]} material={m.black}>
          <boxGeometry args={[BAY_HALF * 2, 0.3, 0.16]} />
        </mesh>
        {/* Transom glazing between the bay head and the canopy */}
        <mesh position={[0, (PANE.h + 0.3 + CANOPY.y - CANOPY.t / 2) / 2, 0.02]} material={m.glass}>
          <planeGeometry args={[BAY_HALF * 2 - 0.2, CANOPY.y - CANOPY.t / 2 - PANE.h - 0.3]} />
        </mesh>

        {/* Cantilevered canopy with linear lights in its soffit */}
        <mesh position={[0, CANOPY.y, CANOPY.depth / 2]} material={m.soffit}>
          <boxGeometry args={[CANOPY.width, CANOPY.t, CANOPY.depth]} />
        </mesh>
        <mesh position={[0, CANOPY.y + CANOPY.t / 2 + 0.03, CANOPY.depth / 2]} material={m.black}>
          <boxGeometry args={[CANOPY.width + 0.04, 0.06, CANOPY.depth + 0.04]} />
        </mesh>
        {[0.9, 2.1, 3.3].map((z) => (
          <mesh key={z} position={[0, CANOPY.y - CANOPY.t / 2 - 0.005, z]} rotation-x={Math.PI / 2} material={m.strip}>
            <planeGeometry args={[CANOPY.width - 1.2, 0.05]} />
          </mesh>
        ))}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (CANOPY.width / 2 - 0.4), CANOPY.y / 2, CANOPY.depth - 0.35]} material={m.black}>
            <cylinderGeometry args={[0.08, 0.08, CANOPY.y, 16]} />
          </mesh>
        ))}
        {/* Light spilling from the canopy on to the paving */}
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.07, CANOPY.depth / 2]}>
          <planeGeometry args={[CANOPY.width + 2, CANOPY.depth + 2.5]} />
          <meshBasicMaterial
            map={canopyGlow()}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            opacity={0.5}
            color="#ffd9a6"
          />
        </mesh>

        {/* Brass lettering above the canopy */}
        <mesh position={[0, 7.25, 0.03]}>
          <planeGeometry args={[8.4, 2.1]} />
          <meshStandardMaterial map={letters} transparent alphaTest={0.3} metalness={0.85} roughness={0.32} />
        </mesh>

        {/* Left wing: one tall glowing slot window */}
        <mesh position={[-(BAY_HALF + 2.6), 4.1, 0.02]} material={m.slot}>
          <planeGeometry args={[0.32, 6.4]} />
        </mesh>
        {/* Warm wash on the concrete around the entrance */}
        <LightPool width={BAY_HALF * 2 + 2} height={FH - 0.4} y={(FH - 0.4) / 2} z={0.004} strength={0.35} color="#ffd29a" />

        {/* Threshold slab through the wall */}
        <mesh position={[0, 0.01, -D / 2]} rotation-x={-Math.PI / 2} material={m.rim}>
          <planeGeometry args={[GATE.width, D + 0.02]} />
        </mesh>
      </group>

      {/* Right wing: vertical bronze fins */}
      <Fins positions={fins} material={m.bronze} />

      {/* Entry path between two raised flower beds */}
      <mesh position={[0, 0.03, (POOL.z1 + POOL.z2) / 2 - 1]} material={m.path}>
        <boxGeometry args={[POOL.x1 * 2 - 0.1, 0.06, POOL.z2 - POOL.z1 + 6]} />
      </mesh>
      {[-1, 1].map((s) => (
        <Planter key={s} side={s} rim={m.rim} ground={m.groundCover} />
      ))}

      {/* Garden lights: lamp posts at the planters' outer corners, strings of bulbs across the plaza */}
      {LAMPS.map(([x, z]) => (
        <LampPost key={`${x},${z}`} x={x} z={z} />
      ))}
      {STRINGS.map(([from, to], i) => (
        <StringLights key={i} from={from} to={to} sag={1.1} />
      ))}
      {/* Their light along the path */}
      {[8.5, 12.5, 16.5].map((z) => (
        <GroundGlow key={z} x={0} z={z} radius={3.2} strength={0.32} />
      ))}
      {BOLLARDS.map(([x, z]) => (
        <GroundGlow key={`g${x},${z}`} x={x} z={z} radius={0.9} strength={0.45} />
      ))}

      {BOLLARDS.map(([x, z]) => (
        <group key={`${x},${z}`} position={[x, 0, z]}>
          <mesh position-y={0.4} material={m.black}>
            <cylinderGeometry args={[0.08, 0.08, 0.8, 16]} />
          </mesh>
          <mesh position-y={0.68} material={m.strip}>
            <cylinderGeometry args={[0.083, 0.083, 0.06, 16]} />
          </mesh>
        </group>
      ))}

      {CYPRESSES.map(([x, z]) => (
        <group key={`${x},${z}`} position={[x, 0, z]}>
          <mesh position-y={0.4} material={m.trunk}>
            <cylinderGeometry args={[0.12, 0.15, 0.8, 8]} />
          </mesh>
          <mesh position-y={3.6} material={m.cypress}>
            <capsuleGeometry args={[0.7, 4.8, 6, 16]} />
          </mesh>
        </group>
      ))}
    </>
  )
}

const BOLLARDS: [number, number][] = [7.5, 11, 14.5, 18].flatMap((z) => [
  [-POOL.x1 + 0.35, z] as [number, number],
  [POOL.x1 - 0.35, z] as [number, number],
])
/** Lamp posts just beyond the planters' outer corners. */
const LAMPS: [number, number][] = [-1, 1].flatMap((s) => [
  [s * (POOL.x2 + 0.8), POOL.z1 - 0.2] as [number, number],
  [s * (POOL.x2 + 0.8), POOL.z2 + 0.2] as [number, number],
])
const LAMP_TOP = LAMP_HEIGHT + 0.05
/** Bulb strings from lamp to lamp across the plaza, and one crisscross down the middle. */
const STRINGS: [[number, number, number], [number, number, number]][] = [
  [[-(POOL.x2 + 0.8), LAMP_TOP, POOL.z1 - 0.2], [POOL.x2 + 0.8, LAMP_TOP, POOL.z1 - 0.2]],
  [[-(POOL.x2 + 0.8), LAMP_TOP, POOL.z2 + 0.2], [POOL.x2 + 0.8, LAMP_TOP, POOL.z2 + 0.2]],
  [[-(POOL.x2 + 0.8), LAMP_TOP, POOL.z1 - 0.2], [POOL.x2 + 0.8, LAMP_TOP, POOL.z2 + 0.2]],
  [[POOL.x2 + 0.8, LAMP_TOP, POOL.z1 - 0.2], [-(POOL.x2 + 0.8), LAMP_TOP, POOL.z2 + 0.2]],
]
const CYPRESSES: [number, number][] = [
  [-13.5, 3],
  [13.5, 3],
  [-15.2, 6.5],
  [15.2, 6.5],
]

let glazing: THREE.Texture | null = null
/** Emissive falloff for the glass: like a lit lobby seen through glazing, with soft curtain folds. */
function glazingGlow() {
  if (glazing) return glazing
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 256
  const ctx = c.getContext('2d')!
  const v = ctx.createLinearGradient(0, 0, 0, 256)
  v.addColorStop(0, 'rgb(70,70,70)')
  v.addColorStop(0.55, 'rgb(170,170,170)')
  v.addColorStop(1, 'rgb(235,235,235)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, 128, 256)
  // sheer curtain folds
  for (let x = 0; x < 128; x += 9) {
    ctx.fillStyle = `rgba(0,0,0,${0.06 + ((x * 7) % 5) * 0.012})`
    ctx.fillRect(x, 0, 4, 256)
  }
  const h = ctx.createLinearGradient(0, 0, 128, 0)
  h.addColorStop(0, 'rgba(0,0,0,0.35)')
  h.addColorStop(0.5, 'rgba(0,0,0,0)')
  h.addColorStop(1, 'rgba(0,0,0,0.35)')
  ctx.fillStyle = h
  ctx.fillRect(0, 0, 128, 256)
  glazing = new THREE.CanvasTexture(c)
  return glazing
}

let glow: THREE.Texture | null = null
/** Soft oval of light under the canopy. */
function canopyGlow() {
  if (glow) return glow
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  ctx.translate(128, 128)
  ctx.scale(1.6, 1)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 80)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(-128, -128, 256, 256)
  glow = new THREE.CanvasTexture(c)
  return glow
}

/** One raised planter where the pools were: a low concrete rim brimming with flowers. */
function Planter({ side, rim, ground }: { side: number; rim: THREE.Material; ground: THREE.Material }) {
  const w = POOL.x2 - POOL.x1
  const d = POOL.z2 - POOL.z1
  const cx = side * (POOL.x1 + POOL.x2) / 2
  const cz = (POOL.z1 + POOL.z2) / 2
  const t = POOL.rimT
  const soil = POOL.rim - 0.04
  return (
    <group position={[cx, 0, cz]}>
      {/* Rim: four low walls */}
      {[-1, 1].map((s) => (
        <mesh key={`x${s}`} position={[0, POOL.rim / 2, s * (d / 2 - t / 2)]} material={rim}>
          <boxGeometry args={[w, POOL.rim, t]} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={`z${s}`} position={[s * (w / 2 - t / 2), POOL.rim / 2, 0]} material={rim}>
          <boxGeometry args={[t, POOL.rim, d - 2 * t]} />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position-y={soil} material={ground}>
        <planeGeometry args={[w - 2 * t, d - 2 * t]} />
      </mesh>
      <FlowerBed width={w - 2 * t} depth={d - 2 * t} y={soil} seed={side > 0 ? 2 : 1} />
    </group>
  )
}

/** Bronze fins in one draw call. */
function Fins({ positions, material }: { positions: [number, number, number][]; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const mat = new THREE.Matrix4()
    positions.forEach((p, i) => {
      mat.makeTranslation(p[0], p[1], p[2])
      mesh.setMatrixAt(i, mat)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [positions])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, positions.length]} material={material}>
      <boxGeometry args={[0.08, FH - 0.8, 0.45]} />
    </instancedMesh>
  )
}
