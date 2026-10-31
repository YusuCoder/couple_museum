import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Canvas } from '@react-three/fiber'
import { KeyboardControls, PerformanceMonitor } from '@react-three/drei'
import { Physics } from '@react-three/rapier'

import { blobKey } from '../content/db'
import { layoutBuilding } from '../content/layout'
import { currentPlace } from '../content/repo'
import { audio } from './audio'
import { SPAWN_OUTSIDE } from './floorplan'
import { Building } from './Building'
import { DEMO_ROOMS } from './demo'
import { ROOM } from './exhibits'
import { Character } from './Character'
import { Effects } from './Effects'
import { Hud } from './Hud'
import { Interaction } from './Interaction'
import { SeatWatcher } from './Seats'
import { KEYMAP, Player } from './Player'
import { useMuseum } from './store'
import { isTouch } from './touch'
import { Together } from './Together'

/**
 * Loads the couple's museum (their account when signed in, else this device),
 * or the demo when it's empty / ?demo is set, and hangs it.
 */
/** This device / demo: a fresh id per tab, so two tabs can walk together; `?as=her` walks as her. */
const LOCAL_ID = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

function useMuseumContent(demo: boolean, asHer: boolean) {
  const [ready, setReady] = useState(false)
  /** Who is walking, and in which museum's channel (null: this device's tabs). */
  const [together, setTogether] = useState<{ museumId: string | null; myId: string }>({ museumId: null, myId: LOCAL_ID })

  useEffect(() => {
    let cancelled = false
    let created: string[] = []
    const { set } = useMuseum.getState()
    set({
      mode: 'intro',
      focusedId: null,
      viewingId: null,
      gate: 'closed',
      nearGate: false,
      doors: {},
      nearDoor: null,
    })

    void (async () => {
      const place = demo
        ? null
        : await currentPlace().catch((e) => {
            console.error('Could not load museum, showing demo', e)
            return null
          })
      const stored = place
        ? await place.repo.load().catch((e) => {
            console.error('Could not load museum, showing demo', e)
            return null
          })
        : null
      // The museum's owner walks as him; whoever they shared it with, as her
      const cloud = place?.museum
      if (!cancelled) {
        set({ me: cloud ? (cloud.role === 'owner' ? 'him' : 'her') : asHer ? 'her' : 'him' })
        setTogether(cloud ? { museumId: cloud.id, myId: cloud.userId } : { museumId: null, myId: LOCAL_ID })
      }
      let content = { rooms: DEMO_ROOMS, names: 'Aziz & Malika', since: '2021' }
      let track: string | null = null

      if (stored?.museum.moments.length) {
        const { museum, urls } = stored
        created = Object.values(urls)
        const media = new Map<string, string>()
        const voice = new Map<string, string>()
        for (const m of museum.moments) {
          if (urls[blobKey.media(m.id)]) media.set(m.id, urls[blobKey.media(m.id)])
          if (urls[blobKey.voice(m.id)]) voice.set(m.id, urls[blobKey.voice(m.id)])
        }
        track = urls[blobKey.music] ?? null
        content = { rooms: layoutBuilding(museum, { media, voice }), names: museum.names, since: museum.since }
      }

      if (cancelled) return created.forEach((u) => URL.revokeObjectURL(u))
      set({ ...content, exhibits: content.rooms.flatMap((r) => r.exhibits) })
      audio().setTrack(track)
      setReady(true)
    })()

    return () => {
      cancelled = true
      audio().setTrack(null)
      audio().suspend()
      if (document.pointerLockElement) document.exitPointerLock()
      created.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [demo, asHer])

  return { ready, together }
}

export default function MuseumPage() {
  const [params] = useSearchParams()
  const { ready, together } = useMuseumContent(params.has('demo'), params.get('as') === 'her')

  // Optional ?view=x,z,yawDeg — handy for screenshots and debugging
  const view = params.get('view')?.split(',').map(Number)
  // Visitors arrive on the plaza, facing the front door
  // She arrives a step to his left, so the two never start inside each other
  const me = useMuseum((s) => s.me)
  const base: [number, number] = view ? [view[0], view[1]] : SPAWN_OUTSIDE
  const spawn: [number, number] = me === 'her' ? [base[0] - 0.9, base[1]] : base
  const yaw = view?.[2] ? (view[2] * Math.PI) / 180 : 0

  const quality = useMuseum((s) => s.quality)
  // Phones start lighter already; if one still struggles, drop to plain 1× pixels
  const [phoneDpr, setPhoneDpr] = useState(1.25)

  if (!ready) return <div className="museum-loading">Hanging your memories…</div>

  return (
    <div className="museum">
      <KeyboardControls map={KEYMAP}>
        <Canvas
          dpr={isTouch ? [1, phoneDpr] : quality === 'high' ? [1, 1.75] : [1, 1.25]}
          gl={{ antialias: false, powerPreference: 'high-performance' }}
          camera={{ fov: 62, near: 0.05, far: 600, position: [spawn[0], ROOM.eyeHeight, spawn[1]], rotation: [0, yaw, 0] }}
        >
          {/* Step down once if the machine can't hold a smooth frame rate */}
          <PerformanceMonitor flipflops={1} onDecline={() => (isTouch ? setPhoneDpr(1) : useMuseum.getState().set({ quality: 'low' }))} />
          <Suspense fallback={null}>
            <Physics gravity={[0, -9.81, 0]}>
              <Building />
              <Player spawn={spawn} />
            </Physics>
            <Character />
            <Together museumId={together.museumId} myId={together.myId} />
            <Effects />
          </Suspense>
          <Interaction />
          <SeatWatcher />
        </Canvas>
        <Hud />
      </KeyboardControls>
    </div>
  )
}
