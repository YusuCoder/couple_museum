import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { useFrame, useThree } from '@react-three/fiber'
import { useAnimations, useGLTF } from '@react-three/drei'

import type { Body } from './body'
import { bodies, embraceHer, embraceHim, makeRig, rigs } from './embrace'
import { CENTER_Y, RUN, WALK, playerState } from './Player'
import { finishStanding, type Seat } from './Seats'
import { useMuseum } from './store'

/**
 * The couple: MetaPerson avatars animated in Mixamo, each packed into one .glb
 * with its clips (Idle / walk / Run in place; SitDown, Sitting, StandUp; and
 * more for later) and a few face shapes (blink, smile).
 */
const HIM = '/models/him.glb'
const HER = '/models/her.glb'

const TURN_RATE = 10
/** Bench clips play a little quicker than Mixamo's (they are slow and deliberate). */
const SIT_SPEED = 1.25
/** Seconds to blend between clips on the bench. */
const BENCH_BLEND = 0.45
/** Hide a body whenever the camera is inside or right next to its head. */
const MIN_CAMERA_DISTANCE = 0.75
const BENCH_CLIPS = ['SitDown', 'Sitting', 'StandUp'] as const
/**
 * People live on their own layer: the main camera sees it, the floor's
 * reflection camera (layer 0 only) doesn't — drawing two skinned figures a
 * second time for a faint blurred reflection cost more than it gave.
 */
export const PEOPLE_LAYER = 1
const head = new THREE.Vector3()
const _dir = new THREE.Vector3()

interface AvatarProps {
  url: string
  who: 'him' | 'her'
  /** Metres; the model is rescaled to this. */
  height: number
  body: Body
  /** Walking clip, and the ground speeds (m/s) at which the walk and run clips' feet look planted. */
  walkClip: string
  walkSpeed: number
  runSpeed: number
  /** Whether to draw the body this frame (head = world position of the head). */
  visible: (camera: THREE.Camera, head: THREE.Vector3) => boolean
  /** The stand-up clip ended. */
  onStood: () => void
}

/**
 * Bench clips from Mixamo carry the hips: back on to the seat (SitDown), then
 * forward off it (StandUp), while the sitting clip sits at the origin. Shift
 * Sitting and StandUp so each starts where the previous one ended: the figure
 * then never jumps, every change can cross-fade, and the body stays where the
 * visitor stood.
 */
const rebased = new WeakSet<THREE.AnimationClip[]>()
function rebaseBenchClips(clips: THREE.AnimationClip[]) {
  if (rebased.has(clips)) return
  rebased.add(clips)
  const hips = (name: string) => clips.find((c) => c.name === name)?.tracks.find((t) => t.name === 'Hips.position')
  const down = hips('SitDown')
  if (!down) return
  const n = down.values.length
  const end = { x: down.values[n - 3], z: down.values[n - 1] }
  for (const name of ['Sitting', 'StandUp']) {
    const t = hips(name)
    if (!t) continue
    const dx = end.x - t.values[0]
    const dz = end.z - t.values[2]
    for (let i = 0; i < t.values.length; i += 3) {
      t.values[i] += dx
      t.values[i + 2] += dz
    }
  }
}

export function Avatar({ url, who, height, body, walkClip, walkSpeed, runSpeed, visible, onStood }: AvatarProps) {
  const { scene, animations } = useGLTF(url)
  const root = useRef<THREE.Group>(null)
  const camera = useThree((s) => s.camera)

  // Own copy of the skinned model
  const { model, scale } = useMemo(() => {
    const m = clone(scene)
    m.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.frustumCulled = false
        o.layers.set(PEOPLE_LAYER)
      }
    })
    m.updateMatrixWorld(true)
    const size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3())
    return { model: m, scale: height / size.y }
  }, [scene, height])

  const face = useFace(model)
  useMemo(() => rebaseBenchClips(animations), [animations])
  useEffect(() => {
    camera.layers.enable(PEOPLE_LAYER)
  }, [camera])

  const { actions } = useAnimations(animations, root)
  useEffect(() => {
    for (const name of ['Idle', walkClip, 'Run']) {
      const a = actions[name]
      if (!a) continue
      a.reset().play()
      a.setEffectiveWeight(name === 'Idle' ? 1 : 0)
    }
    for (const name of ['SitDown', 'StandUp']) {
      const a = actions[name]
      if (!a) continue
      a.setLoop(THREE.LoopOnce, 1)
      a.clampWhenFinished = true
    }
  }, [actions, walkClip])

  // Register for the embrace, and measure how far sitting down carries the hips
  useEffect(() => {
    const rig = makeRig(model)
    rigs[who] = rig
    bodies[who] = body
    const hips = model.getObjectByName('Hips')
    const track = animations.find((a) => a.name === 'SitDown')?.tracks.find((t) => t.name === 'Hips.position')
    if (hips?.parent && track) {
      const k = hips.parent.getWorldScale(new THREE.Vector3()).z * scale
      body.sitShift = Math.abs(track.values[track.values.length - 1] - track.values[2]) * k
    }
    return () => {
      if (rigs[who] === rig) delete rigs[who]
      if (bodies[who] === body) delete bodies[who]
    }
  }, [model, animations, scale, who, body])

  const yaw = useRef<number | null>(null)
  const phase = useRef<Seat['phase'] | null>(null)
  /** Weight of each bench clip (walking gets what is left), eased. */
  const weights = useRef<Record<string, number>>({ SitDown: 0, Sitting: 0, StandUp: 0 })
  /** Left-over offset after the body jumps (teleports), eased away so the figure glides instead. */
  const slide = useRef(new THREE.Vector3())
  const last = useRef<THREE.Vector3 | null>(null)

  useFrame((_, dt) => {
    const g = root.current
    if (!g) return
    const { position: p, velocity: v } = body

    // A bench clip finished: move on
    const done = (name: string) => !!actions[name] && actions[name].time >= actions[name].getClip().duration - 0.001
    if (phase.current === 'down' && body.seat?.phase === 'down' && done('SitDown')) body.seat.phase = 'sitting'
    if (phase.current === 'up' && body.seat?.phase === 'up' && done('StandUp')) onStood()
    const seat = body.seat

    // A new bench phase: start its clip (it fades in below)
    const now = seat?.phase ?? null
    const active = now === 'down' ? 'SitDown' : now === 'sitting' ? 'Sitting' : now === 'up' ? 'StandUp' : null
    if (now !== phase.current) {
      phase.current = now
      if (active) actions[active]?.reset().setEffectiveTimeScale(active === 'Sitting' ? 1 : SIT_SPEED).setEffectiveWeight(0).play()
    }

    // Glide over jumps of the body (sitting down, stepping into view mode)
    if (last.current && last.current.distanceTo(p) > 0.3) slide.current.add(last.current).sub(p)
    last.current = (last.current ?? new THREE.Vector3()).copy(p)
    slide.current.multiplyScalar(Math.exp(-dt * 9))
    g.position.set(p.x, p.y - CENTER_Y, p.z).add(slide.current)

    head.set(g.position.x, g.position.y + (seat ? 1.15 : 1.58), g.position.z)
    g.visible = visible(camera, head)

    if (body.faceYaw !== null) {
      yaw.current = body.faceYaw
      body.faceYaw = null
    }
    if (yaw.current === null) {
      camera.getWorldDirection(_dir)
      yaw.current = who === 'him' ? Math.atan2(_dir.x, _dir.z) : body.yaw
    }
    const speed = seat ? 0 : Math.hypot(v.x, v.z)
    const moving = speed > 0.15
    const target = seat ? seat.yaw : moving ? Math.atan2(v.x, v.z) : body.holdYaw
    if (target !== null) {
      const diff = Math.atan2(Math.sin(target - yaw.current), Math.cos(target - yaw.current))
      yaw.current += diff * (1 - Math.exp(-dt * (seat || moving ? TURN_RATE : 3)))
    }
    g.rotation.y = yaw.current
    body.yaw = yaw.current
    face(dt)

    // Cross-fade: the current bench clip in, the others out; walking gets the rest
    const w = weights.current
    const step = dt / BENCH_BLEND
    for (const name of BENCH_CLIPS) {
      w[name] = THREE.MathUtils.clamp(w[name] + (name === active ? step : -step), 0, 1)
      const a = actions[name]
      if (!a) continue
      if (w[name] > 0) a.setEffectiveWeight(w[name])
      else if (a.isRunning()) a.stop()
    }
    const walking = Math.max(0, 1 - w.SitDown - w.Sitting - w.StandUp)

    // Blend idle → walk → run by speed, and pace the clips to the ground speed so feet don't slide
    let idle = 0
    let walk = 0
    let run = 0
    if (speed <= WALK) {
      walk = speed / WALK
      idle = 1 - walk
    } else {
      run = Math.min((speed - WALK) / (RUN - WALK), 1)
      walk = 1 - run
    }
    actions.Idle?.setEffectiveWeight(idle * walking)
    actions[walkClip]?.setEffectiveWeight(walk * walking).setEffectiveTimeScale(THREE.MathUtils.clamp(speed / walkSpeed, 0.6, 1.8))
    actions.Run?.setEffectiveWeight(run * walking).setEffectiveTimeScale(THREE.MathUtils.clamp(speed / runSpeed, 0.6, 1.4))
  })

  // After this frame's animation has been applied: the embrace bends the arms on top of it
  useFrame(() => {
    const k = THREE.MathUtils.smoothstep(body.embrace, 0, 1)
    const me = rigs[who]
    const otherWho = who === 'him' ? 'her' : 'him'
    const other = rigs[otherWho]
    const otherBody = bodies[otherWho]
    if (k <= 0 || !me || !other || !otherBody || !root.current) return
    root.current.updateMatrixWorld(true)
    if (who === 'him') embraceHim(me, other, body.yaw, otherBody.yaw, k)
    else embraceHer(me, other, body.yaw, otherBody.yaw, k)
  })

  return (
    <group ref={root}>
      <primitive object={model} scale={model.scale.clone().multiplyScalar(scale)} />
      <BlobShadow />
    </group>
  )
}

/** The visitor. */
export function Character() {
  return (
    <Avatar
      url={HIM}
      who="him"
      height={1.78}
      body={playerState}
      walkClip="Walk"
      walkSpeed={1.64}
      runSpeed={4.65}
      onStood={finishStanding}
      visible={(camera, h) => {
        const { view, mode } = useMuseum.getState()
        // Seen through his eyes: no body in the way
        return view === 'third' && mode !== 'viewing' && camera.position.distanceTo(h) > MIN_CAMERA_DISTANCE
      }}
    />
  )
}

/** Her model and how it moves (see Partner). */
export const HER_MODEL = { url: HER, height: 1.68, walkClip: 'DwarfWalk', walkSpeed: 1.42, runSpeed: 3.08 }

/** Face shapes the model carries (morph targets on the head and lashes). */
function useFace(model: THREE.Object3D) {
  const meshes = useMemo(() => {
    const out: THREE.Mesh[] = []
    model.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && m.morphTargetDictionary && m.morphTargetInfluences) out.push(m)
    })
    return out
  }, [model])
  const blink = useRef({ next: 2 + Math.random() * 3, t: -1 })

  const set = (name: string, value: number) => {
    for (const m of meshes) {
      const i = m.morphTargetDictionary![name]
      if (i !== undefined) m.morphTargetInfluences![i] = value
    }
  }

  // A hint of a smile, always
  useEffect(() => {
    set('mouthSmileLeft', 0.18)
    set('mouthSmileRight', 0.18)
    set('cheekSquintLeft', 0.08)
    set('cheekSquintRight', 0.08)
  }, [meshes])

  /** Blink every few seconds: a quick close, a slightly slower open. */
  return (dt: number) => {
    const b = blink.current
    b.next -= dt
    if (b.next <= 0 && b.t < 0) b.t = 0
    if (b.t < 0) return
    b.t += dt
    const CLOSE = 0.07
    const OPEN = 0.12
    const v = b.t < CLOSE ? b.t / CLOSE : Math.max(1 - (b.t - CLOSE) / OPEN, 0)
    set('eyeBlinkLeft', v)
    set('eyeBlinkRight', v)
    if (b.t >= CLOSE + OPEN) {
      b.t = -1
      b.next = 2 + Math.random() * 4
    }
  }
}

/** Soft contact shadow under the feet — cheap, and stops the figure looking pasted on. */
function BlobShadow() {
  const texture = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(0,0,0,0.55)')
    g.addColorStop(0.45, 'rgba(0,0,0,0.25)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(c)
  }, [])
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.005} renderOrder={1} layers={PEOPLE_LAYER}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  )
}

useGLTF.preload(HIM)
useGLTF.preload(HER)
