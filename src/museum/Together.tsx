import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

import { makeBody } from './body'
import { Avatar, MODELS } from './Character'
import { playerState } from './Player'
import { romance } from './Skylight'
import { useMuseum } from './store'
import { connect, partnerOf, pruneRemotes, remotes, sample, type Link, type Pose, type Who } from './presence'

/** Reports per second while moving, and how often to repeat an unchanged one. */
const SEND_HZ = 10
const IDLE_REPEAT_MS = 1000
/** The embrace: where she stands relative to him (m, his frame), and how much each turns to the other. */
const HUG = { side: 0.42, ahead: 0.12, herTurn: -0.62, hisTurn: 0.22 }
/** Seconds to settle into the embrace, and to let go. */
const HUG_IN = 1.1
const HUG_OUT = 0.35
/** Both must stand still in the light this long, this close, before she steps in. */
const STILL_BEFORE_HUG = 0.7
const HUG_REACH = 1.8
/** Further apart than this and the moment is over. */
const HUG_BREAK = 2.4

const fwd = (yaw: number) => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
const left = (yaw: number) => new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))

/** Bodies of the people drawn here, by id (the embrace reads the partner's). */
const remoteBodies = new Map<string, ReturnType<typeof makeBody>>()

/**
 * Everyone else walking this museum, and the link that tells them about this
 * visitor. `museumId` null: this device / demo (tabs of one browser).
 */
export function Together({ museumId, myId }: { museumId: string | null; myId: string }) {
  const [ids, setIds] = useState<string[]>([])
  const link = useRef<Link | null>(null)

  useEffect(() => {
    const refresh = () => {
      setIds([...remotes.keys()])
      useMuseum.getState().set({ partnerHere: !!partnerOf(useMuseum.getState().me) })
    }
    useMuseum.getState().set({ link: { state: 'connecting' } })
    const l = connect(museumId, refresh, (link) => useMuseum.getState().set({ link }))
    link.current = l

    let lastSent = ''
    let lastAt = 0
    const timer = setInterval(() => {
      const me = useMuseum.getState().me
      const p = playerState.position
      const v = playerState.velocity
      const pose: Pose = {
        id: myId,
        who: me,
        x: round(p.x),
        y: round(p.y),
        z: round(p.z),
        vx: round(v.x),
        vz: round(v.z),
        yaw: round(playerState.yaw),
        seat: playerState.seat,
        t: Date.now(),
      }
      // Standing still: repeat now and then (so a late arrival sees us), not ten times a second
      const key = JSON.stringify({ ...pose, t: 0 })
      const now = performance.now()
      if (key === lastSent && now - lastAt < IDLE_REPEAT_MS) return
      lastSent = key
      lastAt = now
      l.send(pose)
      if (pruneRemotes()) refresh()
    }, 1000 / SEND_HZ)

    return () => {
      clearInterval(timer)
      l.close()
      link.current = null
      useMuseum.getState().set({ partnerHere: false })
      setIds([])
    }
  }, [museumId, myId])

  useEmbrace()

  return (
    <>
      {ids.map((id) => (
        <RemotePerson key={id} id={id} />
      ))}
    </>
  )
}

const round = (n: number) => Math.round(n * 1000) / 1000

/** Someone else's figure, following their reports. */
function RemotePerson({ id }: { id: string }) {
  const body = useMemo(() => makeBody(), [])
  const [who, setWho] = useState<Who>(() => remotes.get(id)?.who ?? 'her')
  const seatKey = useRef('')

  useEffect(() => {
    remoteBodies.set(id, body)
    return () => {
      remoteBodies.delete(id)
    }
  }, [id, body])

  useFrame(() => {
    const r = remotes.get(id)
    if (!r) return
    if (r.who !== who) setWho(r.who)
    const pose = sample(r, body.position, body.velocity)
    if (!pose) return
    body.holdYaw = pose.yaw
    // Take their bench state when it changes (the Avatar moves sitting-down → sitting on by itself in between)
    const key = pose.seat ? `${pose.seat.x},${pose.seat.z},${pose.seat.phase}` : ''
    if (key !== seatKey.current) {
      seatKey.current = key
      body.seat = pose.seat ? { ...pose.seat } : null
    }
  })

  const model = MODELS[who]
  return (
    <Avatar
      key={who}
      {...model}
      who={who}
      local={false}
      body={body}
      visible={(camera, head) => camera.position.distanceTo(head) > 0.45}
      onStood={() => {
        body.seat = null
      }}
    />
  )
}

/**
 * Standing still together in the Skylight room's circle of light: she steps in
 * close (her own figure walks there by itself), his arm goes round her waist,
 * her hand to his shoulder. Each visitor's screen works this out from the two
 * positions, so both see it at the same moment.
 */
function useEmbrace() {
  const st = useRef({ state: 'apart' as 'apart' | 'together', still: 0, embrace: 0 })

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const s = st.current
    const { me, mode } = useMuseum.getState()
    const partner = partnerOf(me)
    const other = partner ? remoteBodies.get(partner[0]) : undefined
    const mine = playerState

    let target = 0
    if (other) {
      const dist = Math.hypot(other.position.x - mine.position.x, other.position.z - mine.position.z)
      const otherInLight =
        romance.inside.size > 0 && Math.hypot(other.position.x - romance.centre.x, other.position.z - romance.centre.z) < romance.radius
      const mySpeed = Math.hypot(mine.velocity.x, mine.velocity.z)
      const otherSpeed = Math.hypot(other.velocity.x, other.velocity.z)
      const free = (mode === 'walking' || mode === 'paused') && !mine.seat && !other.seat

      if (s.state === 'apart') {
        const ready = free && otherInLight && dist < HUG_REACH && mySpeed < 0.1 && otherSpeed < 0.1
        s.still = ready ? s.still + dt : 0
        if (s.still > STILL_BEFORE_HUG) {
          s.state = 'together'
          s.still = 0
          if (me === 'her') {
            // Step in on his left, turned a little towards him
            const spot = other.position.clone().addScaledVector(left(other.yaw), HUG.side).addScaledVector(fwd(other.yaw), HUG.ahead)
            mine.steer = { x: spot.x, z: spot.z }
            mine.holdYaw = other.yaw + HUG.herTurn
          } else mine.holdYaw = mine.yaw + HUG.hisTurn
        }
      } else {
        const walkedOff = mySpeed > 0.3 && !mine.steer
        if (walkedOff || !free || !otherInLight || dist > HUG_BREAK) {
          s.state = 'apart'
          mine.steer = null
          mine.holdYaw = null
        } else if (dist < 0.6 && mySpeed < 0.2 && otherSpeed < 0.2) target = 1
      }
    } else if (s.state === 'together') {
      s.state = 'apart'
      mine.steer = null
      mine.holdYaw = null
    }

    s.embrace = THREE.MathUtils.clamp(s.embrace + (target ? dt / HUG_IN : -dt / HUG_OUT), 0, 1)
    mine.embrace = s.embrace
    for (const b of remoteBodies.values()) b.embrace = s.embrace
  })
}
