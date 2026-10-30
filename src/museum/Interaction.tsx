import { useEffect } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { PointerLockControls } from '@react-three/drei'

import { audio } from './audio'
import { ROOM } from './exhibits'
import { openNearDoor } from './Doors'
import { ROTUNDA, SHAPES } from './floorplan'
import { playerState, thirdPersonPose } from './Player'
import { rigs } from './embrace'
import { partnerState } from './Partner'
import { sitDown, standUp } from './Seats'
import { romance } from './Skylight'
import { exhibitRegistry, occluders, useMuseum, type ExhibitHandle } from './store'
import { controlling, isTouch, stick } from './touch'

const FOCUS_RANGE = 4.2
/** While seated, any of these gets the visitor up. */
const STAND_KEYS = new Set(['KeyE', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
const UP = new THREE.Vector3(0, 1, 0)

// Module-level so the DOM HUD can trigger the same actions as the keyboard.
let controls: { lock(): void; unlock(): void } | null = null
let camera: THREE.PerspectiveCamera | null = null
const tween = {
  active: false,
  t: 0,
  duration: 1.2,
  fromP: new THREE.Vector3(),
  toP: new THREE.Vector3(),
  fromQ: new THREE.Quaternion(),
  toQ: new THREE.Quaternion(),
  done: null as null | (() => void),
}

function glideTo(pos: THREE.Vector3, quat: THREE.Quaternion, done: (() => void) | null = null) {
  if (!camera) return
  tween.fromP.copy(camera.position)
  tween.fromQ.copy(camera.quaternion)
  tween.toP.copy(pos)
  tween.toQ.copy(quat)
  tween.t = 0
  tween.duration = THREE.MathUtils.clamp(0.7 + camera.position.distanceTo(pos) * 0.12, 0.9, 1.8)
  tween.done = done
  tween.active = true
}

const STAND_MARGIN = 0.45 // keep the body this far from the walls

/**
 * Where the visitor stands to look at an exhibit, seen through their own eyes:
 * far enough back that the frame fills most of the view, eyes at real eye
 * height, gaze dipped slightly so the frame sits above the caption panel.
 */
function viewPose(h: ExhibitHandle, cam: THREE.PerspectiveCamera) {
  const halfFov = THREE.MathUtils.degToRad(cam.fov) / 2
  const dist = Math.max(
    h.height / (2 * Math.tan(halfFov) * 0.6),
    h.width / (2 * Math.tan(halfFov) * cam.aspect * 0.78),
  )
  const pos = h.center.clone().addScaledVector(h.normal, dist)
  // Stay inside the exhibit's room: a circle for the rotunda, a rectangle otherwise
  const spec = SHAPES[h.room.shape]
  if (h.room.shape === 'rotunda') {
    const dx = pos.x
    const dz = pos.z - h.room.z
    const max = ROTUNDA.radius - STAND_MARGIN - 0.3
    const d = Math.hypot(dx, dz)
    if (d > max) {
      pos.x = (dx / d) * max
      pos.z = h.room.z + (dz / d) * max
    }
  } else {
    pos.x = THREE.MathUtils.clamp(pos.x, -spec.width / 2 + STAND_MARGIN, spec.width / 2 - STAND_MARGIN)
    pos.z = THREE.MathUtils.clamp(pos.z, h.room.z - spec.length / 2 + STAND_MARGIN, h.room.z + spec.length / 2 - STAND_MARGIN)
  }
  pos.y = ROOM.eyeHeight
  const look = h.center.clone()
  look.y -= h.height * 0.14
  const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, look, UP))
  return { pos, quat }
}

/** Head level again, keeping the direction the visitor was facing. */
function levelGaze(q: THREE.Quaternion) {
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ')
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.06, e.y, 0, 'YXZ'))
}

export function lockPointer() {
  audio().start()
  if (!isTouch) return controls?.lock()
  // Touch screens have no pointer lock: the scene is live as soon as they're in
  void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {})
  const { mode, set } = useMuseum.getState()
  if (mode === 'intro' || mode === 'paused') set({ mode: playerState.seat ? 'sitting' : 'walking' })
}

/** Pause (the touch screens' Esc). */
export function pause() {
  const s = useMuseum.getState()
  if (s.mode === 'walking' || s.mode === 'sitting') s.set({ mode: 'paused', focusedId: null })
}

/** E / click / tap while walking: view the exhibit in focus, else open a door, sit down or open the front doors. */
export function interact() {
  const { mode, focusedId } = useMuseum.getState()
  if (mode !== 'walking') return
  if (focusedId) enterView(focusedId)
  else if (!openNearDoor() && !sitDown()) openGate()
}

export function enterView(id: string) {
  const h = exhibitRegistry.get(id)
  const { mode, set } = useMuseum.getState()
  if (!h || !camera || (mode !== 'walking' && mode !== 'viewing')) return
  set({ mode: 'viewing', viewingId: id, focusedId: null })
  const { pos, quat } = viewPose(h, camera)
  // The visitor steps up to the frame and faces it; the camera becomes their eyes
  playerState.teleport = { x: pos.x, z: pos.z, yaw: Math.atan2(-h.normal.x, -h.normal.z) }
  glideTo(pos, quat)
  if (document.pointerLockElement) controls?.unlock()
}

/** Next/previous exhibit in story order. */
export function stepView(dir: 1 | -1) {
  const { viewingId, exhibits } = useMuseum.getState()
  const ids = exhibits.map((e) => e.id).filter((id) => exhibitRegistry.has(id))
  const i = ids.indexOf(viewingId ?? '')
  if (i < 0) return
  enterView(ids[(i + dir + ids.length) % ids.length])
}

/** Step back out of the visitor's eyes, behind them where they stand. `relock` must come from a click/key gesture. */
export function exitView(relock: boolean) {
  const { mode, view, set } = useMuseum.getState()
  if (mode !== 'viewing' || !camera) return
  set({ mode: 'returning', viewingId: null })
  // Touch screens never lock the pointer (a phone browser may grant it, and the thumb stick then stops working)
  if (relock && !isTouch) controls?.lock()
  const quat = levelGaze(camera.quaternion)
  const body = playerState.position
  const pos =
    view === 'third'
      ? thirdPersonPose(body, quat, camera.aspect)
      : new THREE.Vector3(body.x, ROOM.eyeHeight, body.z)
  glideTo(pos, quat, () => useMuseum.getState().set({ mode: controlling() ? 'walking' : 'paused' }))
}

/** Swing the front doors open (only when standing near them). */
export function openGate() {
  const s = useMuseum.getState()
  if (s.gate === 'closed' && s.nearGate) s.set({ gate: 'opening', nearGate: false })
}

export function toggleView() {
  const { view, set } = useMuseum.getState()
  set({ view: view === 'first' ? 'third' : 'first' })
}

export function toggleMusic() {
  const music = !useMuseum.getState().music
  useMuseum.getState().set({ music })
  audio().setMusic(music)
}

const raycaster = new THREE.Raycaster()
const CENTER = new THREE.Vector2(0, 0)
raycaster.far = FOCUS_RANGE

export function Interaction() {
  const cam = useThree((s) => s.camera) as THREE.PerspectiveCamera

  useEffect(() => {
    camera = cam
    const listener = audio().listener
    cam.add(listener)
    return () => {
      cam.remove(listener)
    }
  }, [cam])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { mode } = useMuseum.getState()
      if (e.code === 'KeyM' && mode !== 'intro') toggleMusic()
      if (e.code === 'KeyV' && (mode === 'walking' || mode === 'paused' || mode === 'sitting')) toggleView()
      if (mode === 'walking' && e.code === 'KeyE') interact()
      else if (mode === 'sitting' && STAND_KEYS.has(e.code)) standUp()
      else if (mode === 'viewing') {
        if (e.code === 'KeyE' || e.code === 'Space') exitView(true)
        else if (e.code === 'Escape' || e.code === 'Backspace') exitView(false)
        else if (e.code === 'ArrowRight' || e.code === 'KeyD') stepView(1)
        else if (e.code === 'ArrowLeft' || e.code === 'KeyA') stepView(-1)
      }
    }
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && !isTouch) interact()
    }
    // Clicking the scene (not the HUD) while viewing returns to walking
    const onClick = (e: MouseEvent) => {
      if (!isTouch && useMuseum.getState().mode === 'viewing' && e.target instanceof HTMLCanvasElement) exitView(true)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('click', onClick)
    }
  }, [])

  // Touch: drag the scene to look around, tap it to do what E does
  const canvas = useThree((s) => s.gl.domElement)
  useEffect(() => {
    if (!isTouch) return
    const euler = new THREE.Euler(0, 0, 0, 'YXZ')
    let look: { id: number; x: number; y: number; startX: number; startY: number; t: number } | null = null
    const down = (e: PointerEvent) => {
      if (look) return
      look = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, t: performance.now() }
    }
    const move = (e: PointerEvent) => {
      if (!look || e.pointerId !== look.id || !camera) return
      const { mode } = useMuseum.getState()
      const dx = e.clientX - look.x
      const dy = e.clientY - look.y
      look.x = e.clientX
      look.y = e.clientY
      if (mode !== 'walking' && mode !== 'sitting') return
      // A full-height drag turns about one field of view
      const k = THREE.MathUtils.degToRad(camera.fov) / window.innerHeight
      euler.setFromQuaternion(camera.quaternion)
      euler.y -= dx * k
      euler.x = THREE.MathUtils.clamp(euler.x - dy * k, -1.45, 1.45)
      camera.quaternion.setFromEuler(euler)
    }
    const up = (e: PointerEvent) => {
      if (!look || e.pointerId !== look.id) return
      const tap = Math.hypot(e.clientX - look.startX, e.clientY - look.startY) < 12 && performance.now() - look.t < 350
      look = null
      if (!tap) return
      const { mode } = useMuseum.getState()
      if (mode === 'walking') interact()
      else if (mode === 'viewing') exitView(true)
    }
    const cancel = (e: PointerEvent) => {
      if (look?.id === e.pointerId) look = null
    }
    canvas.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [canvas])

  useFrame((state, dt) => {
    // Portrait screens: open the view up so the scene isn't a narrow slot (62° is the landscape view)
    const pc = state.camera as THREE.PerspectiveCamera
    const fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(29)) / pc.aspect)), 62, 84)
    if (Math.abs(fov - pc.fov) > 0.1) {
      pc.fov = fov
      pc.updateProjectionMatrix()
    }
    // Sitting: pushing the stick gets up, like the walking keys
    if (useMuseum.getState().mode === 'sitting' && Math.hypot(stick.x, stick.y) > 0.5) standUp()

    if (tween.active) {
      tween.t = Math.min(tween.t + dt / tween.duration, 1)
      const k = tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - (-2 * tween.t + 2) ** 3 / 2 // easeInOutCubic
      state.camera.position.lerpVectors(tween.fromP, tween.toP, k)
      state.camera.quaternion.slerpQuaternions(tween.fromQ, tween.toQ, k)
      if (tween.t >= 1) {
        tween.active = false
        tween.done?.()
      }
    }

    const { mode, focusedId, view, set } = useMuseum.getState()
    if (mode !== 'walking') return
    raycaster.far = FOCUS_RANGE + (view === 'third' ? 2.3 : 0) // camera sits behind the character
    raycaster.setFromCamera(CENTER, state.camera)
    const handles = [...exhibitRegistry.values()]
    const hits = raycaster.intersectObjects([...handles.map((h) => h.hit), ...occluders], false)
    // The nearest thing wins — if that's a wall, nothing is focused
    const id = hits.length ? (handles.find((h) => h.hit === hits[0].object)?.exhibit.id ?? null) : null
    if (id !== focusedId) set({ focusedId: id })
  })

  // Phones: no pointer lock at all (see lockPointer)
  if (isTouch) return null
  return (
    <PointerLockControls
      ref={(c) => {
        controls = c
      }}
      // Lock only via lockPointer() — never on arbitrary document clicks
      selector="#__no-auto-lock"
      onLock={() => {
        if (useMuseum.getState().mode !== 'returning') useMuseum.getState().set({ mode: playerState.seat ? 'sitting' : 'walking' })
      }}
      onUnlock={() => {
        const s = useMuseum.getState()
        if (s.mode === 'walking' || s.mode === 'sitting') s.set({ mode: 'paused', focusedId: null })
      }}
    />
  )
}

// Dev-only handle for scripted testing (headless browsers can't pointer-lock)
if (import.meta.env.DEV) {
  Object.assign(window, { __museum: { useMuseum, sitDown, standUp, partnerState, romance, rigs, enterView, exitView, stepView, exhibitRegistry, openGate, openNearDoor, playerState, getCamera: () => camera } })
}
