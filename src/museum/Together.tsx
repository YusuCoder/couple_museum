import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

import { makeBody } from './body'
import { Avatar, MODELS } from './Character'
import { playerState } from './Player'
import { romance } from './Skylight'
import { useMuseum } from './store'
import { connect, partnerOf, pruneRemotes, remoteBodies, remotes, sample, shareWorld, type Link, type Pose, type Who } from './presence'
import { useSharedWorld, worldSnapshot } from './world'

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
/**
 * Holding hands: side by side this close (m) and facing the same way for a
 * moment, the hands join; they let go when the two drift further than `away`.
 */
const HANDS = { near: 1.15, away: 1.6, apart: 0.74, dwell: 0.35, in: 0.45, out: 0.3 }

const fwd = (yaw: number) => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
const left = (yaw: number) => new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))


/**
 * Everyone else walking this museum, and the link that tells them about this
 * visitor. `museumId` null: this device / demo (tabs of one browser).
 */
export function Together({ museumId, myId }: { museumId: string | null; myId: string }) {
  const [ids, setIds] = useState<string[]>([])
  const link = useRef<Link | null>(null)

  useEffect(() => {
    let known = new Set<string>()
    const refresh = () => {
      // Someone new: bring them up to date with doors and films
      if ([...remotes.keys()].some((id) => !known.has(id))) setTimeout(() => shareWorld(worldSnapshot()), 300)
      known = new Set(remotes.keys())
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
  useHoldHands()
  useSharedWorld()

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
      // The lights dim when either is in the circle; the embrace needs both in it
      const inLight = (p: THREE.Vector3) =>
        romance.inside.size > 0 && Math.hypot(p.x - romance.centre.x, p.z - romance.centre.z) < romance.radius
      const otherInLight = inLight(other.position) && inLight(mine.position)
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

const _to = new THREE.Vector3()
const _side = new THREE.Vector3()

/**
 * Walking (or standing) side by side, close and facing the same way, the two
 * take each other's hand. Each visitor's screen works it out from the two
 * positions, so both see the hands join. While they walk, each is helped a
 * little to stay at arm's length and in step with the other.
 */
function useHoldHands() {
  const st = useRef({ on: false, dwell: 0, level: 0 })

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const s = st.current
    const { me, mode } = useMuseum.getState()
    const partner = partnerOf(me)
    const other = partner ? remoteBodies.get(partner[0]) : undefined
    const mine = playerState

    let ok = false
    if (other && mode === 'walking' && !mine.seat && !other.seat && mine.embrace <= 0 && !mine.steer) {
      _to.subVectors(other.position, mine.position).setY(0)
      const dist = _to.length()
      const f = fwd(mine.yaw)
      const ahead = Math.abs(_to.dot(f))
      // Facing the same way (1) … opposite ways (-1)
      const together = Math.cos(other.yaw - mine.yaw)
      ok = s.on ? dist < HANDS.away && dist > 0.3 && ahead < 1 && together > 0.1 : dist < HANDS.near && dist > 0.45 && ahead < 0.6 && together > 0.55
    }
    if (s.on) {
      if (!ok) s.on = false
    } else {
      s.dwell = ok ? s.dwell + dt : 0
      if (s.dwell > HANDS.dwell) {
        s.on = true
        s.dwell = 0
      }
    }

    s.level = THREE.MathUtils.clamp(s.level + (s.on ? dt / HANDS.in : -dt / HANDS.out), 0, 1)
    mine.hands = s.level
    for (const [id, b] of remoteBodies) b.hands = partner && id === partner[0] ? s.level : 0

    if (s.on && other) {
      // Where the partner is right now (their figure is shown a moment late)
      _to.subVectors(other.position, mine.position).addScaledVector(other.velocity, 0.16).setY(0)
      const speed = Math.hypot(mine.velocity.x, mine.velocity.z)
      const f = speed > 0.2 ? _side.set(mine.velocity.x / speed, 0, mine.velocity.z / speed).clone() : fwd(mine.yaw)
      // Across my direction of travel: drift to arm's length from them
      _side.set(f.z, 0, -f.x)
      const across = _to.dot(_side)
      const drift = THREE.MathUtils.clamp((Math.abs(across) - HANDS.apart) * 2 * Math.sign(across), -0.4, 0.4)
      // Along it: ease off when ahead of them, step out when behind
      const lead = -_to.dot(f)
      const pace = mine.pace ?? (mine.pace = { side: new THREE.Vector3(), factor: 1 })
      pace.side.copy(_side).multiplyScalar(drift)
      pace.factor = 1 - THREE.MathUtils.clamp(lead * 0.7, -0.3, 0.3)
    } else mine.pace = null
  })
}
