import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CuboidCollider, RigidBody } from '@react-three/rapier'

import { CORRIDOR_TITLE_Z, SKYLIGHT_CENTRE } from '../content/layout'
import { roman } from '../content/roman'
import { CORRIDOR, DOORWAY, GATE, ROTUNDA, SHAPES, WALL } from './floorplan'
import { INTRO, PANELS, ROOM, type RoomContent } from './exhibits'
import { Frame } from './Frame'
import { LightPool } from './LightPool'
import { RoomCtx } from './roomContext'
import { Bench } from './Seats'
import { SolidBox, faces } from './SolidBox'
import { FloorGlow, LightBeam, Petals, Romance } from './Skylight'
import { occluders } from './store'
import { doorSignTexture, wallTitleTexture } from './textures'

const T = WALL

export const wallMaterial = new THREE.MeshStandardMaterial({ color: '#ebe5da', roughness: 0.93 })
export const accentMaterial = new THREE.MeshStandardMaterial({ color: '#3a463f', roughness: 0.9 })
/** The corridor's warm charcoal walls. */
const charcoalMaterial = new THREE.MeshStandardMaterial({ color: '#36302b', roughness: 0.92 })
const baseboardMaterial = new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.6 })
// Ceiling gets almost no direct light (everything points down), so fake its bounce light
const ceilingMaterial = new THREE.MeshStandardMaterial({ color: '#f1eee8', roughness: 1, emissive: '#8a847a', emissiveIntensity: 0.55 })
const darkCeilingMaterial = new THREE.MeshStandardMaterial({ color: '#2c2825', roughness: 1, emissive: '#1a1714', emissiveIntensity: 0.6 })
const skylightMaterial = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#fff4e2', emissiveIntensity: 2.2, toneMapped: false })
const trimMaterial = new THREE.MeshStandardMaterial({ color: '#1f1b18', roughness: 0.5 })

/** Two skylight strips above the hall's corridors, either side of the centre walls. */
export const STRIP_X = [-ROOM.width / 4, ROOM.width / 4]
const STRIP_WIDTH = 1.1

/**
 * One chapter of the story. Every room owns its far wall (doorway on to the
 * next chapter, or solid behind the finale) and — except the first, which
 * opens on the facade — its near wall. In between, the shape decides the
 * rest: a bright hall, a domed rotunda, or a long dark corridor.
 */
export const Room = memo(function Room({
  room,
  index,
  center,
  next,
}: {
  room: RoomContent
  index: number
  center: number
  next?: RoomContent
}) {
  const spec = SHAPES[room.shape]
  const isLast = !next
  const info = useMemo(() => ({ z: center, shape: room.shape }), [center, room.shape])
  const subtitle = room.subtitle || `Chapter ${roman(index + 1)}`
  const sign = useMemo(
    () => (next ? doorSignTexture(`Next · Chapter ${roman(index + 2)}`, next.title) : null),
    [next, index],
  )

  // Each shape's wall finishes towards the room (inner) for its end walls
  const inner = room.shape === 'corridor' ? charcoalMaterial : room.shape === 'hall' ? accentMaterial : wallMaterial
  const nearInner = room.shape === 'corridor' ? charcoalMaterial : wallMaterial
  const farMaterial = useMemo(() => faces(wallMaterial, inner, wallMaterial), [inner])
  const nearMaterial = useMemo(() => faces(wallMaterial, wallMaterial, nearInner), [nearInner])

  const width = spec.width + 2 * T
  const farZ = -spec.length / 2 - T / 2
  const nearZ = spec.length / 2 + T / 2
  // Where the "next chapter" sign hangs (the rotunda's exit is in its curved wall)
  const signZ = room.shape === 'rotunda' ? -ROTUNDA.radius + 0.14 : -spec.length / 2 + 0.01

  let body: ReactNode = null
  let visuals: ReactNode = null
  if (room.shape === 'hall') ({ body, visuals } = hall(room, subtitle, index, isLast))
  else if (room.shape === 'rotunda') ({ body, visuals } = rotunda(room, subtitle, isLast))
  else ({ body, visuals } = corridor(room, subtitle, index, isLast))

  return (
    <>
      <RigidBody type="fixed" colliders={false} position={[0, 0, center]}>
        {index > 0 && <EndWall z={nearZ} width={width} height={spec.height} material={nearMaterial} doorway />}
        <EndWall z={farZ} width={width} height={spec.height} material={farMaterial} doorway={!isLast} />
        {body}
      </RigidBody>

      <group position-z={center}>
        {visuals}
        {sign && (
          <mesh position={[0, DOORWAY.height + 0.6, signZ]}>
            <planeGeometry args={[2.8, 0.7]} />
            <meshBasicMaterial map={sign} transparent toneMapped={false} />
          </mesh>
        )}
        <RoomCtx.Provider value={info}>
          {room.exhibits.map((ex) => (
            <Frame key={ex.id} exhibit={ex} />
          ))}
        </RoomCtx.Provider>
      </group>
    </>
  )
})

// ---------------------------------------------------------------- hall

function hall(room: RoomContent, subtitle: string, index: number, isLast: boolean) {
  const W = ROOM.width
  const L = ROOM.length
  const H = ROOM.height
  const body = (
    <>
      <SolidBox position={[-W / 2 - T / 2, H / 2, 0]} size={[T, H, L]} material={wallMaterial} />
      <SolidBox position={[W / 2 + T / 2, H / 2, 0]} size={[T, H, L]} material={wallMaterial} />
      {/* Title wall near the entrance: chapter title in front, a film behind */}
      <SolidBox position={[0, INTRO.height / 2, INTRO.z]} size={[INTRO.width, INTRO.height, INTRO.depth]} material={wallMaterial} />
      {/* Free-standing centre walls, a large piece on each face */}
      {PANELS.map((p) => (
        <SolidBox key={p.z} position={[0, p.height / 2, p.z]} size={[p.thickness, p.height, p.length]} material={accentMaterial} />
      ))}
      <Bench position={[-3.9, 0, PANELS[0].z]} />
      <Bench position={[3.9, 0, PANELS[0].z]} />
      <Bench position={[-3.9, 0, PANELS[1].z]} />
      <Bench position={[3.9, 0, PANELS[1].z]} />
      <Bench position={[0, 0, (PANELS[0].z + PANELS[1].z) / 2]} rotation={Math.PI / 2} />
      {/* A bench facing the film on the back of the title wall */}
      {room.exhibits.some((e) => e.wall === 'intro') && <Bench position={[0, 0, INTRO.z - 4.4]} rotation={Math.PI / 2} />}
    </>
  )
  const visuals = (
    <>
      <TitlePlane title={room.title} subtitle={subtitle} position={[0, 1.75, INTRO.z + INTRO.depth / 2 + 0.002]} width={3.8} />
      <group position={[0, 0, INTRO.z + INTRO.depth / 2]}>
        <LightPool width={INTRO.width - 0.2} height={INTRO.height - 0.1} y={INTRO.height / 2} strength={0.9} />
      </group>
      {PANELS.map((p) => (
        <mesh key={p.z} position={[0, 0.06, p.z]} material={baseboardMaterial}>
          <boxGeometry args={[p.thickness + 0.04, 0.12, p.length + 0.04]} />
        </mesh>
      ))}
      <Baseboards width={W} length={L} nearGap={index === 0 ? GATE.width : DOORWAY.width} farGap={isLast ? 0 : DOORWAY.width} />
      <mesh position-y={H} rotation-x={Math.PI / 2} material={ceilingMaterial}>
        <planeGeometry args={[W + 2 * T, L + 2 * T]} />
      </mesh>
      {STRIP_X.map((x) => (
        <mesh key={x} position={[x, H - 0.01, 0]} rotation-x={Math.PI / 2} material={skylightMaterial}>
          <planeGeometry args={[STRIP_WIDTH, L - 3]} />
        </mesh>
      ))}
    </>
  )
  return { body, visuals }
}

// ---------------------------------------------------------------- rotunda

const SEGMENTS = 48

const domeMaterial = new THREE.MeshStandardMaterial({
  color: '#f4f0e9',
  roughness: 1,
  emissive: '#a8a093',
  emissiveIntensity: 0.55,
  side: THREE.BackSide,
})

/** Radius of the round skylight at the top of the dome. */
const OCULUS = 2.3

/**
 * The Skylight room: a calm, warm-white round room under a dome with a wide
 * open skylight. A soft beam falls through it on to the floor, where the
 * chapter title lies in the circle of light; the big piece hangs in the beam,
 * the other pictures hang on fine wires in a ring, and petals drift down.
 * Nothing changes when you walk in (no effect or material switches).
 */
function rotunda(room: RoomContent, subtitle: string, isLast: boolean) {
  const R = ROTUNDA.radius
  const H = ROOM.height
  const half = SHAPES.rotunda.length / 2
  const step = (Math.PI * 2) / SEGMENTS
  const doorHalf = Math.asin(DOORWAY.width / 2 / R)
  // Doorways in the curved wall: always towards the entrance (angle 0 = +z), towards the exit unless last
  const doors = isLast ? [0] : [0, Math.PI]
  const angleTo = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
  const inDoor = (a: number) => doors.some((d) => angleTo(a, d) < doorHalf + step / 2 - 0.02)

  const chord = 2 * (R + T / 2) * Math.sin(step / 2) * 1.04
  const segments: { a: number; x: number; z: number }[] = []
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i * step
    if (inDoor(a)) continue
    segments.push({ a, x: Math.sin(a) * (R + T / 2), z: Math.cos(a) * (R + T / 2) })
  }

  // Short passages between the round room and the flat end walls, where the doors are
  const vestStart = Math.sqrt(R * R - (DOORWAY.width / 2 + T) ** 2)
  const vestLen = half - vestStart
  const vestibules = (isLast ? [1] : [1, -1]).map((s) => ({ s, z: s * (vestStart + vestLen / 2) }))

  const thetaStart = Math.asin(OCULUS / R)
  const domeScale = ROTUNDA.dome / R
  const oculusY = H + ROTUNDA.dome * Math.cos(thetaStart)

  const body = (
    <>
      {/* Curved wall: one collider per segment (drawn as one merged mesh, see visuals) */}
      {segments.map(({ a, x, z }) => (
        <CuboidCollider key={a} args={[chord / 2, H / 2, T / 2]} position={[x, H / 2, z]} rotation={[0, a, 0]} />
      ))}
      {doors.map((d) => (
        <SolidBox
          key={d}
          position={[Math.sin(d) * (R + T / 2), (DOORWAY.height + H) / 2, Math.cos(d) * (R + T / 2)]}
          size={[DOORWAY.width + 0.4, H - DOORWAY.height, T]}
          rotationY={d}
          material={wallMaterial}
        />
      ))}
      {vestibules.flatMap(({ s, z }) =>
        [-1, 1].map((side) => (
          <SolidBox
            key={`${s}${side}`}
            position={[side * (DOORWAY.width / 2 + T / 2), H / 2, z]}
            size={[T, H, vestLen + 0.2]}
            material={wallMaterial}
          />
        )),
      )}
      <Bench position={[-4.6, 0, 0]} />
      <Bench position={[4.6, 0, 0]} />
    </>
  )

  const visuals = (
    <>
      <MergedBoxes boxes={segments.map(({ a, x, z }) => ({ size: [chord, H, T], position: [x, H / 2, z], rotY: a }))} material={wallMaterial} occludes />
      <MergedBoxes
        boxes={segments.map(({ a }) => ({ size: [chord * 0.97, 0.12, 0.02], position: [Math.sin(a) * (R - 0.01), 0.06, Math.cos(a) * (R - 0.01)], rotY: a }))}
        material={baseboardMaterial}
      />

      {/* Dome with a wide open skylight */}
      <mesh position-y={H} scale={[1, domeScale, 1]} material={domeMaterial}>
        <sphereGeometry args={[R + 0.02, 72, 24, 0, Math.PI * 2, thetaStart, Math.PI / 2 - thetaStart]} />
      </mesh>
      <mesh position-y={oculusY + 0.01} rotation-x={Math.PI / 2} material={skylightMaterial}>
        <circleGeometry args={[OCULUS + 0.05, 64]} />
      </mesh>
      <LightBeam top={OCULUS} bottom={3.3} height={oculusY} />
      <FloorGlow radius={3.6} />
      <Romance radius={3.3} dome={domeMaterial} />
      <Petals spread={4} height={oculusY} count={120} />

      {/* The chapter title lies on the floor in the circle of light, reading towards the entrance */}
      <group position={[0, 0.025, SKYLIGHT_CENTRE.titleZ]} rotation-x={-Math.PI / 2}>
        <TitlePlane title={room.title} subtitle={subtitle} position={[0, 0, 0]} width={3.6} />
      </group>

      {/* Ceilings of the passages */}
      {vestibules.map(({ s, z }) => (
        <mesh key={s} position={[0, H, z]} rotation-x={Math.PI / 2} material={ceilingMaterial}>
          <planeGeometry args={[DOORWAY.width + 2 * T, vestLen + 0.3]} />
        </mesh>
      ))}
    </>
  )
  return { body, visuals }
}

// ---------------------------------------------------------------- corridor

function corridor(room: RoomContent, subtitle: string, index: number, isLast: boolean) {
  const W = CORRIDOR.width
  const L = CORRIDOR.length
  const H = CORRIDOR.height
  const body = (
    <>
      <SolidBox position={[-W / 2 - T / 2, H / 2, 0]} size={[T, H, L]} material={charcoalMaterial} />
      <SolidBox position={[W / 2 + T / 2, H / 2, 0]} size={[T, H, L]} material={charcoalMaterial} />
    </>
  )
  const visuals = (
    <>
      {/* Chapter title in light lettering on the left wall, just inside */}
      <group position={[-W / 2 + 0.003, 0, CORRIDOR_TITLE_Z]} rotation-y={Math.PI / 2}>
        <TitlePlane title={room.title} subtitle={subtitle} position={[0, 2.05, 0]} width={3} light />
        <LightPool width={3.4} height={H - 0.1} y={(H - 0.1) / 2} strength={2.2} />
      </group>
      <Baseboards width={W} length={L} nearGap={index === 0 ? GATE.width : DOORWAY.width} farGap={isLast ? 0 : DOORWAY.width} />
      <mesh position-y={H} rotation-x={Math.PI / 2} material={darkCeilingMaterial}>
        <planeGeometry args={[W + 2 * T, L + 2 * T]} />
      </mesh>
      {/* One narrow light line down the middle */}
      <mesh position={[0, H - 0.01, 0]} rotation-x={Math.PI / 2} material={skylightMaterial}>
        <planeGeometry args={[0.18, L - 1]} />
      </mesh>
    </>
  )
  return { body, visuals }
}

// ---------------------------------------------------------------- shared parts

interface Box {
  size: [number, number, number]
  position: [number, number, number]
  rotY: number
}

/**
 * Many same-material boxes as a single mesh (one draw call instead of dozens —
 * matters because the reflective floor draws everything twice).
 */
function MergedBoxes({ boxes, material, occludes = false }: { boxes: Box[]; material: THREE.Material; occludes?: boolean }) {
  // Rebuild only when the boxes themselves change, not on every render
  const key = JSON.stringify(boxes)
  const geometry = useMemo(() => {
    const parts = (JSON.parse(key) as Box[]).map(({ size, position, rotY }) =>
      new THREE.BoxGeometry(...size).rotateY(rotY).translate(...position),
    )
    const merged = mergeGeometries(parts, false)
    parts.forEach((g) => g.dispose())
    return merged
  }, [key])
  useEffect(() => () => geometry.dispose(), [geometry])

  const mesh = useRef<THREE.Mesh>(null)
  useEffect(() => {
    if (!occludes) return
    const m = mesh.current!
    occluders.add(m)
    return () => {
      occluders.delete(m)
    }
  }, [occludes])

  return <mesh ref={mesh} geometry={geometry} material={material} />
}

function TitlePlane({
  title,
  subtitle,
  position,
  width,
  light = false,
}: {
  title: string
  subtitle: string
  position: [number, number, number]
  width: number
  light?: boolean
}) {
  const tex = useMemo(() => wallTitleTexture(title, subtitle, light), [title, subtitle, light])
  return (
    // Only the letters: no depth write, so glows behind the plane still show through its clear parts
    <mesh position={position} renderOrder={3}>
      <planeGeometry args={[width, width * (640 / 2048)]} />
      <meshStandardMaterial map={tex} transparent depthWrite={false} roughness={0.9} />
    </mesh>
  )
}

/** A room's near or far wall across its full width, with an optional centred doorway (and dark jamb trim). */
function EndWall({
  z,
  width,
  height,
  material,
  doorway,
}: {
  z: number
  width: number
  height: number
  material: THREE.Material[]
  doorway: boolean
}) {
  if (!doorway) return <SolidBox position={[0, height / 2, z]} size={[width, height, T]} material={material} />
  const side = (width - DOORWAY.width) / 2
  const trim = 0.08
  // The trim lines the opening and stands 3 cm proud of the wall's edges and the
  // lintel's underside — never in the same plane as them (that z-fights / flickers)
  const proud = 0.03
  return (
    <>
      <SolidBox position={[-(DOORWAY.width + side) / 2, height / 2, z]} size={[side, height, T]} material={material} />
      <SolidBox position={[(DOORWAY.width + side) / 2, height / 2, z]} size={[side, height, T]} material={material} />
      <SolidBox position={[0, (DOORWAY.height + height) / 2, z]} size={[DOORWAY.width, height - DOORWAY.height, T]} material={material} />
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (DOORWAY.width / 2 + trim / 2 - proud), (DOORWAY.height + trim - proud) / 2, z]} material={trimMaterial}>
          <boxGeometry args={[trim, DOORWAY.height + trim - proud, T + 0.04]} />
        </mesh>
      ))}
      <mesh position={[0, DOORWAY.height + trim / 2 - proud, z]} material={trimMaterial}>
        <boxGeometry args={[DOORWAY.width + 2 * (trim - proud), trim, T + 0.04]} />
      </mesh>
    </>
  )
}

/** Dark skirting along a rectangular room's walls, with gaps for the doorways. */
function Baseboards({ width: W, length: L, nearGap, farGap }: { width: number; length: number; nearGap: number; farGap: number }) {
  const h = 0.12
  const d = 0.02
  const across = (z: number, gap: number) =>
    gap > 0 ? (
      [-1, 1].map((s) => {
        const len = (W - gap) / 2
        return (
          <mesh key={s} position={[s * (gap / 2 + len / 2), 0, z]} material={baseboardMaterial}>
            <boxGeometry args={[len, h, d]} />
          </mesh>
        )
      })
    ) : (
      <mesh position={[0, 0, z]} material={baseboardMaterial}>
        <boxGeometry args={[W, h, d]} />
      </mesh>
    )
  return (
    <group position-y={h / 2}>
      <mesh position={[-W / 2 + d / 2, 0, 0]} material={baseboardMaterial}>
        <boxGeometry args={[d, h, L]} />
      </mesh>
      <mesh position={[W / 2 - d / 2, 0, 0]} material={baseboardMaterial}>
        <boxGeometry args={[d, h, L]} />
      </mesh>
      {across(-L / 2 + d / 2, farGap)}
      {across(L / 2 - d / 2, nearGap)}
    </group>
  )
}
