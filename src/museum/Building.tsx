import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, MeshReflectorMaterial } from '@react-three/drei'
import { CuboidCollider, RigidBody } from '@react-three/rapier'

import { audio } from './audio'
import { roman } from '../content/roman'
import { InteriorDoor } from './Doors'
import { BUILDING_HALF_WIDTH, SHAPES, WALL, buildingPlan, roomIndexAt } from './floorplan'
import { ROOM } from './exhibits'
import { Exterior } from './Exterior'
import { Fireworks, fireworkGlow } from './Fireworks'
import { NightSky } from './Night'
import { playerState } from './Player'
import { Room, STRIP_X } from './Room'
import { RoomLights } from './RoomLights'
import { romance, romanceLevel } from './Skylight'
import { useMuseum } from './store'
import { concreteTexture } from './textures'
import { isTouch } from './touch'

const W = ROOM.width
const L = ROOM.length
const H = ROOM.height

/** Moonlight comes from behind the visitor's left as they face the front door (so the facade catches it). */
const MOONLIGHT = new THREE.Vector3(-45, 30, 70)

/**
 * The whole museum: plaza and facade outside, then the chapter rooms in a
 * row. Only the room the visitor is in and its neighbours are mounted, so a
 * long story costs no more per frame than a short one.
 */
export function Building() {
  const rooms = useMuseum((s) => s.rooms)
  const shapesKey = rooms.map((r) => r.shape).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => buildingPlan(rooms.map((r) => r.shape)), [shapesKey])
  const [current, setCurrent] = useState(0)
  // Until warmed up, everything is visible so the first frames upload it all to the GPU
  const [warm, setWarm] = useState(false)

  useFrame(() => {
    const z = playerState.position.z
    const i = roomIndexAt(z, plan)
    if (i !== current) setCurrent(i)
    // Third-person camera headroom: the plaza, or this room's ceiling
    playerState.ceiling = z > 0 ? 6 : SHAPES[plan.shapes[i]].height
  })

  return (
    <>
      <LightRig />
      <NightSky />
      <Fireworks />

      <Floor length={plan.length} />
      <Exterior length={plan.length} />

      {/*
        Every room is built once, up front, and only shown when near (this room and
        its neighbours). Building a room on the fly — textures, shaders — froze the
        walk for ~0.3 s at each doorway; toggling visibility is free.
      */}
      {rooms.map((room, i) => (
        <group key={room.id} visible={!warm || Math.abs(i - current) <= 1}>
          <Room room={room} index={i} center={plan.centers[i]} next={rooms[i + 1]} />
        </group>
      ))}

      {rooms.slice(0, -1).map((room, k) => (
        <InteriorDoor
          key={`${room.id}:door`}
          index={k}
          z={plan.centers[k] - SHAPES[plan.shapes[k]].length / 2 - WALL}
          forward={`Chapter ${roman(k + 2)} · ${rooms[k + 1].title}`}
          back={`Chapter ${roman(k + 1)} · ${room.title}`}
        />
      ))}
      {rooms.map((room, i) => {
        const len = (k: number) => SHAPES[plan.shapes[k]].length
        // Just inside the doorway, behind the door's leaves
        const z = i === 0 ? -0.03 : plan.centers[i - 1] - len(i - 1) / 2 - WALL - 0.06
        return (
          <RoomLights
            key={`${room.id}:lights`}
            door={i === 0 ? null : i - 1}
            z={z}
            inside={{ far: plan.centers[i] - len(i) / 2 - WALL, half: BUILDING_HALF_WIDTH }}
          />
        )
      })}
      <WarmUp onDone={() => setWarm(true)} />
    </>
  )
}

/**
 * Precompile every shader and upload every texture while the whole building is
 * visible (behind the title screen), then let far rooms hide. Nothing has to be
 * built for the first time mid-walk.
 */
function WarmUp({ onDone }: { onDone: () => void }) {
  const { gl, scene, camera } = useThree()
  const frames = useRef(0)
  useFrame(() => {
    frames.current++
    if (frames.current === 2) {
      gl.compile(scene, camera)
      scene.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
        for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
          for (const v of Object.values(m)) if (v instanceof THREE.Texture) gl.initTexture(v)
        }
      })
    }
    if (frames.current === 4) onDone()
  })
  return null
}

/** One reflective floor through every room — a single reflection pass however many rooms there are. */
function Floor({ length }: { length: number }) {
  const FW = BUILDING_HALF_WIDTH * 2 // wide enough for the rotunda
  const tex = useMemo(() => {
    const t = concreteTexture()
    t.repeat.set(FW / 5, length / 4.3) // ~5 × 4.3 m slabs
    return t
  }, [length, FW])
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[FW / 2, 0.1, length / 2]} position={[0, -0.1, -length / 2]} />
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, -length / 2]}>
        <planeGeometry args={[FW, length]} />
        {/* Phones: no live reflection (it draws the whole scene a second time every frame); the environment gives the gloss */}
        {isTouch ? (
          <meshStandardMaterial map={tex} roughness={0.45} metalness={0.05} envMapIntensity={0.7} />
        ) : (
        <MeshReflectorMaterial
          map={tex}
          blur={[400, 120]}
          resolution={1024}
          mixBlur={1}
          mixStrength={1.6}
          mixContrast={1}
          roughness={0.7}
          metalness={0.05}
          depthScale={0.6}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.3}
          mirror={0}
        />
        )}
      </mesh>
    </RigidBody>
  )
}

/**
 * Cheap lights only (every light is paid for on every pixel; exhibit spots
 * are faked with LightPool). The moonlight fades out as the visitor goes inside so
 * it never lights the interior through the walls; outdoor sound follows.
 */
const HEMI = { sky: new THREE.Color('#fff8ee'), ground: new THREE.Color('#6b6158'), intensity: 1.1 }
/** Out on the plaza at night: a dim blue sky light instead of the galleries' warm one. */
const NIGHT_HEMI = { sky: new THREE.Color('#5d6f9e'), ground: new THREE.Color('#1c1a20'), intensity: 0.38 }
const MOON_INTENSITY = 0.55
/** Lamp-light tint the room warms to as it dims (see `romance`). */
const HUSH_SKY = new THREE.Color('#ffcf9f')
const FILL = 0.35
/**
 * Light falling through the skylight on to whoever stands in its circle once
 * the room has dimmed. Always mounted (at zero) — adding a light later would
 * recompile every material and freeze a frame.
 */
const SPOT = { intensity: 340, height: 8.5, angle: 0.45, penumbra: 0.7, /** leans in from the entrance side, so faces and fronts catch it */ lean: 2.2 }

function LightRig() {
  const sun = useRef<THREE.DirectionalLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const fill = useRef<THREE.DirectionalLight>(null)
  const spot = useRef<THREE.SpotLight>(null)
  const spotTarget = useMemo(() => new THREE.Object3D(), [])
  const outdoor = useRef(-1)
  const scene = useThree((s) => s.scene)

  useFrame(({ camera }, dt) => {
    // Romantic hush: ease towards dim while someone stands in a skylight's circle
    const target = romance.inside.size > 0 ? 1 : 0
    const rate = target > romance.value ? 1 / romance.dimSeconds : -1 / romance.brightenSeconds
    romance.value = THREE.MathUtils.clamp(romance.value + rate * Math.min(dt, 0.1), 0, 1)
    const k = romanceLevel()
    // 1 on the plaza, 0 a few metres past the door
    const f = THREE.MathUtils.smoothstep(camera.position.z, -4, 2)
    if (hemi.current) {
      const inside = HEMI.intensity * (1 - 0.68 * k)
      // Each firework burst lights the plaza for an instant
      hemi.current.intensity = THREE.MathUtils.lerp(inside, NIGHT_HEMI.intensity + fireworkGlow.value * 0.9, f)
      hemi.current.color.copy(HEMI.sky).lerp(HUSH_SKY, k).lerp(NIGHT_HEMI.sky, f)
      hemi.current.groundColor.copy(HEMI.ground).lerp(NIGHT_HEMI.ground, f)
    }
    if (fill.current) fill.current.intensity = FILL * (1 - 0.8 * k)
    if (spot.current) {
      spot.current.intensity = SPOT.intensity * k
      if (k > 0) {
        spot.current.position.set(romance.centre.x, SPOT.height, romance.centre.z + SPOT.lean)
        spotTarget.position.set(romance.centre.x, 0, romance.centre.z)
        spotTarget.updateMatrixWorld()
      }
    }
    // The galleries' reflections would light the night outside too brightly
    scene.environmentIntensity = (1 - 0.65 * k) * (1 - 0.7 * f)

    if (sun.current) sun.current.intensity = MOON_INTENSITY * f
    if (Math.abs(f - outdoor.current) > 0.01) {
      outdoor.current = f
      audio().setOutdoor(f)
    }
  })

  return (
    <>
      <hemisphereLight ref={hemi} args={[HEMI.sky, HEMI.ground, HEMI.intensity]} />
      <directionalLight ref={fill} position={[2, 10, 4]} intensity={FILL} color="#fff3e0" />
      <primitive object={spotTarget} />
      <spotLight ref={spot} target={spotTarget} intensity={0} angle={SPOT.angle} penumbra={SPOT.penumbra} decay={2} distance={0} color="#ffe6c4" />
      {/* Moonlight on the plaza (fades out indoors so it never lights the rooms through the walls) */}
      <directionalLight ref={sun} position={MOONLIGHT.clone().normalize().multiplyScalar(50)} color="#a9bce6" intensity={MOON_INTENSITY} />

      {/* Image-based light for reflections on the floor, glass and brass */}
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#2a2622']} />
        {STRIP_X.map((x) => (
          <Lightformer key={x} form="rect" intensity={3} color="#fff4e2" position={[x, H, 0]} rotation-x={Math.PI / 2} scale={[1.2, L - 4, 1]} />
        ))}
        <Lightformer form="rect" intensity={0.6} color="#efe7da" position={[-W / 2, 2, 0]} rotation-y={Math.PI / 2} scale={[L, 4, 1]} />
        <Lightformer form="rect" intensity={0.6} color="#efe7da" position={[W / 2, 2, 0]} rotation-y={-Math.PI / 2} scale={[L, 4, 1]} />
      </Environment>
    </>
  )
}
