import { useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'

import { audio } from './audio'
import { INTRO, INTRO_FILM, PANELS, ROOM, type Exhibit } from './exhibits'
import { LightPool } from './LightPool'
import { SHAPES } from './floorplan'
import { isTouch } from './touch'
import { RoomCtx } from './roomContext'
import { exhibitRegistry, useMuseum } from './store'
import { placeholderPhoto, plaqueTexture } from './textures'

const FRAME_BORDER = 0.05
const FRAME_DEPTH = 0.05
const MAT = 0.12 // passe-partout margin
const BEZEL = 0.035 // video screen bezel

const frameMaterial = new THREE.MeshStandardMaterial({ color: '#1b1714', roughness: 0.45, metalness: 0.1 })
const matMaterial = new THREE.MeshStandardMaterial({ color: '#f3efe6', roughness: 0.95, emissive: '#fff1dc', emissiveIntensity: 0.12 })
const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: '#ffffff',
  roughness: 0.04,
  metalness: 0,
  transparent: true,
  opacity: 0.08,
  clearcoat: 1,
  depthWrite: false,
})
const wireMaterial = new THREE.MeshStandardMaterial({ color: '#b89a63', metalness: 0.9, roughness: 0.35 })
const bezelMaterial = new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.25, metalness: 0.4 })

/** Imperative hooks a media child exposes to the exhibit (e.g. "replay"). */
type MediaRef = RefObject<{ replay?: () => void }>

export function Frame({ exhibit }: { exhibit: Exhibit }) {
  return exhibit.kind === 'video' ? <VideoFrame exhibit={exhibit} /> : <PhotoFrame exhibit={exhibit} />
}

/** Videos all play on the same widescreen screen; a film of another shape is fitted inside it. */
const SCREEN_ASPECT = 16 / 9
/** Screens this wide or wider (the room's centre film, the finale) take the film's own shape. */
const BIG_SCREEN = 2

/** Largest w × h of the given aspect that fits inside maxW × maxH. */
function fit(aspect: number, maxW: number, maxH: number): [number, number] {
  return aspect >= maxW / maxH ? [maxW, maxW / aspect] : [maxH * aspect, maxH]
}

function PhotoFrame({ exhibit }: { exhibit: Exhibit }) {
  const { tex, aspect } = usePhoto(exhibit)
  const media: MediaRef = useRef({})

  // Frame shaped to the photo: long side = the spot's size
  const long = exhibit.size ?? 1.1
  const pw = aspect >= 1 ? long : long * aspect
  const ph = aspect >= 1 ? long / aspect : long
  const mw = pw + MAT * 2
  const mh = ph + MAT * 2
  const fw = mw + FRAME_BORDER * 2
  const fh = mh + FRAME_BORDER * 2

  return (
    <ExhibitShell exhibit={exhibit} fw={fw} fh={fh} media={media} spotlight>
      <FrameBars fw={fw} fh={fh} />
      <mesh position-z={0.01} material={matMaterial} receiveShadow>
        <planeGeometry args={[mw, mh]} />
      </mesh>
      <mesh position-z={0.012}>
        <planeGeometry args={[pw, ph]} />
        <meshStandardMaterial map={tex} roughness={0.55} emissiveMap={tex} emissive="#ffe6c4" emissiveIntensity={0.32} />
      </mesh>
      <MatBevel pw={pw} ph={ph} />
      <mesh position-z={FRAME_DEPTH - 0.008} material={glassMaterial} renderOrder={1}>
        <planeGeometry args={[mw, mh]} />
      </mesh>
      {exhibit.voice && <VoiceNote exhibit={exhibit} media={media} />}
    </ExhibitShell>
  )
}

function VideoFrame({ exhibit }: { exhibit: Exhibit }) {
  const [aspect, setAspect] = useState(exhibit.aspect)
  const media: MediaRef = useRef({})

  // Wall spots: the same 16:9 screen for every video, the film fitted inside it (black
  // bars at the sides of a vertical phone video). The big centre screens are shaped to
  // the film itself, long side = the spot's size, so a vertical film still fills them.
  const size = exhibit.size ?? 1.8
  const [pw, ph] =
    exhibit.wall === 'intro'
      ? fit(aspect, size, INTRO_FILM.maxHeight)
      : size >= BIG_SCREEN
        ? aspect >= 1
          ? [size, size / aspect]
          : [size * aspect, size]
        : fit(aspect, size, size / SCREEN_ASPECT)
  const fw = (size >= BIG_SCREEN ? pw : size) + BEZEL * 2
  const fh = (size >= BIG_SCREEN ? ph : size / SCREEN_ASPECT) + BEZEL * 2

  return (
    <ExhibitShell exhibit={exhibit} fw={fw} fh={fh} media={media}>
      <mesh position-z={0.02} material={bezelMaterial}>
        <boxGeometry args={[fw, fh, 0.04]} />
      </mesh>
      <VideoScreen exhibit={exhibit} width={pw} height={ph} onAspect={setAspect} media={media} />
    </ExhibitShell>
  )
}

/**
 * Everything around the artwork itself: placement on the wall, brass plaque,
 * spotlight (brightens when looked at), and registration for look-at raycasts.
 */
function ExhibitShell({
  exhibit,
  fw,
  fh,
  media,
  spotlight = false,
  children,
}: {
  exhibit: Exhibit
  fw: number
  fh: number
  media: MediaRef
  spotlight?: boolean
  children: ReactNode
}) {
  const plaque = useMemo(
    () =>
      plaqueTexture(
        exhibit.title,
        exhibit.date,
        exhibit.caption,
        exhibit.voice ? '♪  voice note' : exhibit.video ? '▶  film with sound' : undefined,
      ),
    [exhibit.title, exhibit.date, exhibit.caption, exhibit.voice, exhibit.video],
  )
  const { position, rotationY } = placement(exhibit, fh, fw)
  const plaqueX = fw / 2 + 0.32
  const plaqueY = -fh / 2 + 0.2

  // On a curved wall: where the wall's centre of curvature is (local z), and how far
  // the wall has come forward at the plaque so the plaque sits on it rather than in it
  const curve = exhibit.curve ? { axisZ: Math.hypot(position[0], position[2]), radius: exhibit.curve } : undefined
  const plaqueZ =
    (curve ? Math.max(0, curve.axisZ - Math.sqrt(curve.radius ** 2 - (plaqueX + 0.21) ** 2)) : 0) + 0.006

  const hit = useRef<THREE.Mesh>(null)
  const bob = useRef<THREE.Group>(null)
  const room = useContext(RoomCtx)
  // Hanging pictures sway almost imperceptibly on their wires, each in its own rhythm
  const phase = position[0] * 1.3 + position[2] * 0.7
  useFrame(({ clock }) => {
    if (!exhibit.hang || !bob.current) return
    const t = clock.elapsedTime + phase
    bob.current.rotation.y = Math.sin(t * 0.31) * 0.025
    bob.current.rotation.z = Math.sin(t * 0.47) * 0.004
  })
  // Wires run from the frame's top corners up into the dome
  const wireLength = ROOM.height + 0.8 - (position[1] + fh / 2)
  useEffect(() => {
    const [x, y, localZ] = placement(exhibit, fh, fw).position
    const z = localZ + room.z
    const normal = new THREE.Vector3(Math.sin(rotationY), 0, Math.cos(rotationY))
    const center = new THREE.Vector3(x, y, z).addScaledVector(normal, FRAME_DEPTH)
    exhibitRegistry.set(exhibit.id, {
      exhibit,
      hit: hit.current!,
      center,
      normal,
      width: fw,
      height: fh,
      replay: () => media.current.replay?.(),
      room,
    })
    return () => {
      exhibitRegistry.delete(exhibit.id)
    }
  }, [exhibit, fw, fh, rotationY, media, room])

  return (
    <group position={position} rotation-y={rotationY}>
      {exhibit.hang && (
        <RigidBody type="fixed" colliders={false}>
          <CuboidCollider args={[fw / 2, fh / 2 + 0.05, 0.15]} position={[0, 0, FRAME_DEPTH / 2]} />
        </RigidBody>
      )}
      <group ref={bob}>
      {exhibit.hang && (
        <>
          {/* Linen-backed board behind, so a hanging picture seen from behind is solid */}
          <mesh rotation-y={Math.PI} position-z={-0.001}>
            <planeGeometry args={[fw, fh]} />
            <meshStandardMaterial color="#d9d1c4" roughness={0.9} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * (fw / 2 - 0.12), fh / 2 + wireLength / 2, FRAME_DEPTH / 2]} material={wireMaterial}>
              <cylinderGeometry args={[0.0035, 0.0035, wireLength, 6]} />
            </mesh>
          ))}
        </>
      )}
      {children}

      {/* Brass plaque, bottom-right like a real gallery label */}
      <group position={[plaqueX, plaqueY, plaqueZ]}>
        <mesh castShadow>
          <boxGeometry args={[0.42, 0.158, 0.008]} />
          <meshStandardMaterial color="#b8955a" metalness={0.8} roughness={0.35} />
        </mesh>
        <mesh position-z={0.0045}>
          <planeGeometry args={[0.4, 0.15]} />
          <meshStandardMaterial map={plaque} metalness={0.55} roughness={0.38} />
        </mesh>
      </group>

      {/* Invisible look-at target covering frame + plaque */}
      <mesh ref={hit} visible={false} position={[0.38, 0, FRAME_DEPTH]}>
        <planeGeometry args={[fw + 0.76, fh + 0.2]} />
      </mesh>

      </group>

      {spotlight && !exhibit.hang && (
        <ExhibitLight exhibit={exhibit} fw={fw} fh={fh} centerY={position[1]} ceiling={SHAPES[room.shape].height} curve={curve} />
      )}
    </group>
  )
}

/** Height of the wall an exhibit hangs on — light pools must not spill past it. */
function wallTop(ex: Exhibit) {
  if (ex.top !== undefined) return ex.top
  if (ex.wall === 'panel') return PANELS[ex.panel ?? 0].height
  if (ex.wall === 'intro') return INTRO.height
  return ROOM.height
}

/**
 * Ceiling can light + the oval of warm light it throws on the wall (a fake
 * spotlight — see LightPool). Brightens while the exhibit is focused or viewed.
 */
function ExhibitLight({
  exhibit,
  fw,
  fh,
  centerY,
  ceiling,
  curve,
}: {
  exhibit: Exhibit
  fw: number
  fh: number
  centerY: number
  ceiling: number
  curve?: { axisZ: number; radius: number }
}) {
  // Pool: brightest just above the frame's centre, long fade towards the floor,
  // clipped to the wall (centre walls and the intro wall are shorter than the room)
  const width = Math.max(fw, fh) * 1.25 + 0.6
  const top = Math.min(fh * 0.15 + width * 0.72, wallTop(exhibit) - centerY - 0.02)
  const bottom = Math.max(fh * 0.15 - width * 1.28, -centerY + 0.02)

  const can = { y: ceiling - 0.15 - centerY, z: 1.7 }
  const lit = () => {
    const s = useMuseum.getState()
    return s.focusedId === exhibit.id || s.viewingId === exhibit.id
  }

  return (
    <>
      <LightPool
        width={width}
        height={top - bottom}
        y={(top + bottom) / 2}
        // Dark feature walls need more light to show a pool at all
        strength={exhibit.dark ? 2.6 : 1.3}
        boost={lit}
        curve={curve}
      />
      <mesh position={[0, can.y + 0.05, can.z]} rotation-x={Math.atan2(can.z, can.y)}>
        <cylinderGeometry args={[0.06, 0.08, 0.22, 20]} />
        <meshStandardMaterial color="#111" roughness={0.4} metalness={0.6} />
      </mesh>
    </>
  )
}

const _world = new THREE.Vector3()

/**
 * Exhibit sound on a phone: plain left/right panning instead of HRTF (the
 * "3D headphones" model costs far more) and no hall reverb, so a film's
 * voice plays clean without starving the audio thread. Desktop keeps both.
 */
function exhibitSound(listener: THREE.AudioListener, reverbIn: AudioNode) {
  const sound = new THREE.PositionalAudio(listener)
  if (isTouch) sound.panner.panningModel = 'equalpower'
  else sound.getOutput().connect(reverbIn)
  return sound
}

/** Films' distance to the camera last frame: on a phone only the nearest one plays. */
const filmDistance = new Map<string, number>()
const nearestFilm = () => {
  let best = ''
  let bestD = Infinity
  for (const [id, d] of filmDistance) if (d < bestD) [best, bestD] = [id, d]
  return best
}

/** Positional voice note that plays when the visitor walks up to the exhibit. */
function VoiceNote({ exhibit, media }: { exhibit: Exhibit; media: MediaRef }) {
  const anchor = useRef<THREE.Group>(null)
  const armed = useRef(true)

  useEffect(() => {
    const a = audio()
    const sound = exhibitSound(a.listener, a.reverbIn)
    sound.setRefDistance(1.2)
    sound.setRolloffFactor(1.6)
    sound.setDirectionalCone(150, 280, 0.35)
    anchor.current!.add(sound)

    let disposed = false
    new THREE.AudioLoader().load(exhibit.voice!, (buf) => {
      if (!disposed) sound.setBuffer(buf)
    })

    const key = `voice:${exhibit.id}`
    const baseEnded = THREE.PositionalAudio.prototype.onEnded.bind(sound)
    sound.onEnded = () => {
      baseEnded()
      a.duck(key, false)
    }
    media.current.replay = () => {
      if (!sound.buffer) return
      if (sound.isPlaying) sound.stop()
      sound.play()
      a.duck(key, true)
    }

    return () => {
      disposed = true
      if (sound.isPlaying) sound.stop()
      a.duck(key, false)
      sound.removeFromParent()
      sound.getOutput().disconnect()
      media.current.replay = undefined
    }
  }, [exhibit.id, exhibit.voice, media])

  useFrame(({ camera }) => {
    const mode = useMuseum.getState().mode
    if (mode === 'intro' || !anchor.current) return
    const dist = camera.position.distanceTo(anchor.current.getWorldPosition(_world))
    if (armed.current && dist < 2.6) {
      media.current.replay?.()
      armed.current = false
    } else if (dist > 4.5) armed.current = true
  })

  return <group ref={anchor} position-z={0.15} />
}

/** In-wall film: plays with positional sound while the visitor is nearby. */
function VideoScreen({
  exhibit,
  width,
  height,
  onAspect,
  media,
}: {
  exhibit: Exhibit
  width: number
  height: number
  onAspect: (a: number) => void
  media: MediaRef
}) {
  const anchor = useRef<THREE.Group>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const ducked = useRef(false)
  const retryAt = useRef(0)
  const [tex, setTex] = useState<THREE.VideoTexture | null>(null)
  const key = `video:${exhibit.id}`

  useEffect(() => {
    const a = audio()
    const el = document.createElement('video')
    el.src = exhibit.video!
    el.loop = true
    el.playsInline = true
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    el.onloadedmetadata = () => onAspect(el.videoWidth / el.videoHeight)

    const sound = exhibitSound(a.listener, a.reverbIn)
    sound.setMediaElementSource(el)
    sound.setRefDistance(1.6)
    sound.setRolloffFactor(1.4)
    sound.setDirectionalCone(160, 300, 0.3)
    anchor.current!.add(sound)

    const t = new THREE.VideoTexture(el)
    t.colorSpace = THREE.SRGBColorSpace
    setTex(t)
    video.current = el
    media.current.replay = () => {
      el.currentTime = 0
      void el.play().catch(() => {})
    }

    return () => {
      el.pause()
      el.removeAttribute('src')
      el.load()
      sound.removeFromParent()
      sound.getOutput().disconnect()
      t.dispose()
      a.duck(`video:${exhibit.id}`, false)
      filmDistance.delete(exhibit.id)
      video.current = null
      media.current.replay = undefined
    }
  }, [exhibit.id, exhibit.video, onAspect, media])

  useFrame(({ camera, clock }) => {
    const el = video.current
    if (!el || !anchor.current) return
    const mode = useMuseum.getState().mode
    const dist = camera.position.distanceTo(anchor.current.getWorldPosition(_world))
    filmDistance.set(exhibit.id, dist)
    // A phone decodes one film at a time: the closest
    const near = mode !== 'intro' && mode !== 'paused' && dist < 9 && (!isTouch || nearestFilm() === exhibit.id)

    if (near && el.paused && clock.elapsedTime > retryAt.current) {
      // Autoplay can be refused before the first click; back off instead of retrying every frame
      el.play().catch(() => (retryAt.current = clock.elapsedTime + 2))
    } else if (!near && !el.paused) el.pause()

    const duck = near && dist < 5
    if (duck !== ducked.current) {
      ducked.current = duck
      audio().duck(key, duck)
    }
  })

  return (
    <>
      <group ref={anchor} position-z={0.15} />
      <mesh position-z={0.041}>
        <planeGeometry args={[width, height]} />
        {tex ? <meshBasicMaterial map={tex} toneMapped={false} /> : <meshStandardMaterial color="#050505" roughness={0.2} />}
      </mesh>
    </>
  )
}

/** Loads the exhibit's photo, falling back to a generated placeholder. */
function usePhoto(ex: Exhibit) {
  const placeholder = useMemo(
    () => placeholderPhoto(ex.title, ex.aspect, ex.hue ?? ['#ddd', '#555']),
    [ex.title, ex.aspect, ex.hue],
  )
  const [photo, setPhoto] = useState<{ tex: THREE.Texture; aspect: number }>({ tex: placeholder, aspect: ex.aspect })

  useEffect(() => {
    if (!ex.src) return
    let cancelled = false
    new THREE.TextureLoader().load(ex.src, (tex) => {
      if (cancelled) return tex.dispose()
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 8
      const img = tex.image as HTMLImageElement
      setPhoto({ tex, aspect: img.width / img.height })
    })
    return () => {
      cancelled = true
    }
  }, [ex.src])

  return photo
}

function FrameBars({ fw, fh }: { fw: number; fh: number }) {
  const b = FRAME_BORDER
  const z = FRAME_DEPTH / 2
  const bars: [number, number, number, number][] = [
    [0, fh / 2 - b / 2, fw, b],
    [0, -fh / 2 + b / 2, fw, b],
    [-fw / 2 + b / 2, 0, b, fh - 2 * b],
    [fw / 2 - b / 2, 0, b, fh - 2 * b],
  ]
  return (
    <>
      {bars.map(([x, y, w, h], i) => (
        <mesh key={i} position={[x, y, z]} material={frameMaterial} castShadow>
          <boxGeometry args={[w, h, FRAME_DEPTH]} />
        </mesh>
      ))}
    </>
  )
}

/** Thin white bevel lip around the photo window — sells the mat cut. */
function MatBevel({ pw, ph }: { pw: number; ph: number }) {
  const t = 0.006
  const edges: [number, number, number, number][] = [
    [0, ph / 2 + t / 2, pw + 2 * t, t],
    [0, -ph / 2 - t / 2, pw + 2 * t, t],
    [-pw / 2 - t / 2, 0, t, ph],
    [pw / 2 + t / 2, 0, t, ph],
  ]
  return (
    <>
      {edges.map(([x, y, w, h], i) => (
        <mesh key={i} position={[x, y, 0.013]}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial color="#fffdf8" roughness={0.8} />
        </mesh>
      ))}
    </>
  )
}

/**
 * Where an exhibit hangs; big frames are lifted so their bottom edge clears the
 * floor, and frames on a curved wall stand off it just enough for their edges to clear it.
 */
function placement(ex: Exhibit, frameHeight: number, frameWidth: number): { position: [number, number, number]; rotationY: number } {
  const halfW = ROOM.width / 2
  const halfL = ROOM.length / 2
  const y = Math.max(ROOM.artHeight, frameHeight / 2 + 0.45)
  switch (ex.wall) {
    case 'left':
      return { position: [-halfW, y, ex.along], rotationY: Math.PI / 2 }
    case 'right':
      return { position: [halfW, y, ex.along], rotationY: -Math.PI / 2 }
    case 'end':
      return { position: [ex.along, y + 0.15, -halfL], rotationY: 0 }
    case 'intro':
      return { position: [ex.along, frameHeight / 2 + INTRO_FILM.bottom, INTRO.z - INTRO.depth / 2], rotationY: Math.PI }
    case 'panel': {
      const p = PANELS[ex.panel ?? 0]
      const left = ex.face === 'left'
      return {
        position: [left ? -p.thickness / 2 : p.thickness / 2, y + 0.1, p.z + ex.along],
        rotationY: left ? -Math.PI / 2 : Math.PI / 2,
      }
    }
    case 'free': {
      const rotY = ex.rotY ?? 0
      // A flat frame on a concave wall touches it in the middle; its edges would sink by the sagitta
      const inset = ex.curve ? (frameWidth / 2) ** 2 / (2 * ex.curve) + 0.01 : 0
      return {
        position: [(ex.x ?? 0) + Math.sin(rotY) * inset, y, (ex.z ?? 0) + Math.cos(rotY) * inset],
        rotationY: rotY,
      }
    }
  }
}
