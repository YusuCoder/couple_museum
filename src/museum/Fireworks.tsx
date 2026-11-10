import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'

import { audio } from './audio'
import { playerState } from './Player'
import { useMuseum } from './store'
import { isTouch } from './touch'

/**
 * Fireworks over the museum when the visitors arrive on the plaza: first an
 * ordinary show, then a volley of rockets whose sparks gather into a message
 * in the sky — "Welcome to my heart, my love ❤" — hold, twinkle, and fall.
 *
 * Modelled on real shells: a mortar thump and a thin tail going up, a flash
 * that lights the plaza, then stars thrown out hard and stopped by the air
 * within a moment, so each burst snaps open and hangs before drooping —
 * white-hot at first, cooling to its colour, trailing embers or crackling out.
 *
 * One point cloud, simulated on the CPU (some thousands of sparks is nothing),
 * drawn additively so overlapping sparks glow.
 */

const MAX = 16000
const GRAVITY = -9.8
/** Phones draw a lighter show: fewer stars, thinner trails. */
const LITE = isTouch ? 0.65 : 1
/** Where the message hangs: above the building, facing the plaza. */
const TEXT = { y: 18, z: -3 }
/** The show, in seconds from its start. */
const SHOW = { volleyAt: 12.4, fuse: 1.25, fly: 1.7, hold: 8, fall: 2.6 }
const VOLLEY = 6

const PALETTE = ['#ff3b5c', '#ffcf5a', '#59d8ff', '#b46bff', '#ff8a2b', '#f4f7ff', '#ff6fb0', '#7dff8e', '#ffe9b0']
const GOLD = new THREE.Color('#ffb85a')
const SILVER = new THREE.Color('#eef2ff')
const WHITE = new THREE.Color('#ffffff')

/**
 * Lights the plaza for a moment at each burst (read by the building's light
 * rig): 1 at the flash, fading in a fraction of a second.
 */
export const fireworkGlow = { value: 0 }

const Kind = { Dead: 0, Star: 1, Ember: 2, Shell: 3, Letter: 4, Flash: 5 } as const
type Burst = 'peony' | 'chrysanthemum' | 'willow' | 'palm' | 'ring' | 'crackle' | 'heart' | 'letters'

interface Sim {
  kind: Uint8Array
  pos: Float32Array
  vel: Float32Array
  /** Drawn colour (changes as a star cools) and the colour it burns. */
  col: Float32Array
  base: Float32Array
  alpha: Float32Array
  size: Float32Array
  age: Float32Array
  life: Float32Array
  drag: Float32Array
  grav: Float32Array
  /** Stars: embers shed per second, how long those glow, and whether the star crackles as it dies. */
  trail: Float32Array
  trailLife: Float32Array
  glitter: Uint8Array
  /** Letters: start and target positions. */
  from: Float32Array
  to: Float32Array
  /** Shells: what they burst into, how big, and (the message) which letters they carry. */
  burst: (Burst | null)[]
  power: Float32Array
  cargo: (number[] | null)[]
  free: number
}

function makeSim(): Sim {
  return {
    kind: new Uint8Array(MAX),
    pos: new Float32Array(MAX * 3),
    vel: new Float32Array(MAX * 3),
    col: new Float32Array(MAX * 3),
    base: new Float32Array(MAX * 3),
    alpha: new Float32Array(MAX),
    size: new Float32Array(MAX),
    age: new Float32Array(MAX),
    life: new Float32Array(MAX),
    drag: new Float32Array(MAX),
    grav: new Float32Array(MAX),
    trail: new Float32Array(MAX),
    trailLife: new Float32Array(MAX),
    glitter: new Uint8Array(MAX),
    from: new Float32Array(MAX * 3),
    to: new Float32Array(MAX * 3),
    burst: new Array(MAX).fill(null),
    power: new Float32Array(MAX),
    cargo: new Array(MAX).fill(null),
    free: 0,
  }
}

function alloc(s: Sim) {
  for (let n = 0; n < MAX; n++) {
    const i = (s.free + n) % MAX
    if (s.kind[i] === Kind.Dead) {
      s.free = (i + 1) % MAX
      return i
    }
  }
  return -1
}

const _c = new THREE.Color()
const _d = new THREE.Vector3()

interface StarOptions {
  life: number
  size?: number
  /** Share of gravity felt (stars are light: they hang, then droop). */
  grav?: number
  /** Air resistance: a star thrown at speed v travels v / drag before it hangs. */
  drag?: number
  trail?: number
  trailLife?: number
  glitter?: boolean
}

/** A burning star thrown out by a shell. */
function star(s: Sim, x: number, y: number, z: number, v: THREE.Vector3, color: THREE.Color, o: StarOptions) {
  const i = alloc(s)
  if (i < 0) return
  s.kind[i] = Kind.Star
  s.pos.set([x, y, z], i * 3)
  s.vel.set([v.x, v.y, v.z], i * 3)
  s.base.set([color.r, color.g, color.b], i * 3)
  s.col.set([1.6, 1.6, 1.6], i * 3)
  s.alpha[i] = 1
  s.size[i] = (o.size ?? 0.36) * 1.3
  s.age[i] = 0
  s.life[i] = o.life
  s.grav[i] = o.grav ?? 0.3
  s.drag[i] = o.drag ?? STAR_DRAG
  s.trail[i] = (o.trail ?? 0) * LITE
  s.trailLife[i] = o.trailLife ?? 0.5
  s.glitter[i] = o.glitter ? 1 : 0
}

/** A glowing speck left behind: by a star (its trail) or a shell on its way up. */
function ember(s: Sim, x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number, life: number, size: number) {
  const i = alloc(s)
  if (i < 0) return
  s.kind[i] = Kind.Ember
  s.pos.set([x, y, z], i * 3)
  s.vel.set([vx, vy, vz], i * 3)
  s.base.set([r, g, b], i * 3)
  s.col.set([r, g, b], i * 3)
  s.alpha[i] = 1
  s.size[i] = size
  s.age[i] = 0
  s.life[i] = life
}

/** The instant of the burst: one big bright bloom, gone in a blink. */
function flash(s: Sim, x: number, y: number, z: number, color: THREE.Color, size: number) {
  const i = alloc(s)
  if (i < 0) return
  s.kind[i] = Kind.Flash
  s.pos.set([x, y, z], i * 3)
  _c.copy(color).lerp(WHITE, 0.6)
  s.col.set([_c.r, _c.g, _c.b], i * 3)
  s.alpha[i] = 1
  s.size[i] = size
  s.age[i] = 0
  s.life[i] = 0.16
  fireworkGlow.value = Math.max(fireworkGlow.value, Math.min(1, size / 9))
}

/** A shell fired from a mortar on the ground behind the museum, bursting at `height`. */
function shell(s: Sim, x: number, z: number, height: number, burst: Burst, power = 1, cargo: number[] | null = null) {
  const i = alloc(s)
  if (i < 0) return
  const fuse = SHOW.fuse + (cargo ? 0 : Math.random() * 0.35)
  s.kind[i] = Kind.Shell
  s.pos.set([x, 0.5, z], i * 3)
  // Slowing all the way up, so it bursts near the top of its climb
  const k = 1.5
  s.vel.set([(Math.random() - 0.5) * 1.2, ((height - 0.5) * k) / (1 - Math.exp(-k * fuse)), (Math.random() - 0.5) * 0.6], i * 3)
  s.drag[i] = k
  s.col.set([GOLD.r, GOLD.g, GOLD.b], i * 3)
  s.alpha[i] = 0.9
  s.size[i] = 0.22
  s.age[i] = 0
  s.life[i] = fuse
  s.burst[i] = burst
  s.power[i] = power
  s.cargo[i] = cargo
  audio().fireworkLaunch(0.5)
}

const STAR_DRAG = 2.7

function pick() {
  return new THREE.Color(PALETTE[Math.floor(Math.random() * PALETTE.length)]).multiplyScalar(1.5)
}

function explode(s: Sim, i: number, listener: THREE.Vector3) {
  const x = s.pos[i * 3]
  const y = s.pos[i * 3 + 1]
  const z = s.pos[i * 3 + 2]
  const burst = s.burst[i]!
  const power = s.power[i]
  // The shell's own drift carries into its stars
  const drift = new THREE.Vector3(s.vel[i * 3], s.vel[i * 3 + 1], s.vel[i * 3 + 2]).multiplyScalar(0.5)
  const a = pick()
  let b = pick()
  if (b.equals(a)) b = SILVER.clone().multiplyScalar(1.5)
  const far = Math.hypot(x - listener.x, y - listener.y, z - listener.z)
  audio().fireworkBurst(Math.min(1, (30 / far) * Math.sqrt(power)), far / 343, burst === 'crackle' || burst === 'willow')

  /** Stars thrown evenly over a sphere: `reach` is how far (m) they get before hanging. */
  const sphere = (count: number, reach: number, color: THREE.Color, o: StarOptions, spread = 0.07) => {
    const n = Math.round(count * LITE)
    for (let k = 0; k < n; k++) {
      // Evenly spaced directions (a real shell's stars are packed in a ball), a little unevenness
      const u = 1 - (2 * (k + 0.5)) / n
      const r = Math.sqrt(1 - u * u)
      const th = k * 2.39996 + Math.random() * 0.25
      _d.set(r * Math.cos(th), u, r * Math.sin(th)).multiplyScalar(reach * power * (o.drag ?? STAR_DRAG) * (1 - Math.random() * spread)).add(drift)
      star(s, x, y, z, _d, color, { ...o, life: o.life * (0.85 + Math.random() * 0.3) })
    }
  }

  if (burst === 'letters') {
    flash(s, x, y, z, GOLD, 7)
    // Each spark flies from the burst to its place in the message
    for (const t of s.cargo[i] ?? []) {
      const j = alloc(s)
      if (j < 0) break
      const dir = randomDir()
      const speed = 6 + Math.random() * 4
      s.kind[j] = Kind.Letter
      s.pos.set([x, y, z], j * 3)
      s.from.set([x, y, z], j * 3)
      s.vel.set([dir.x * speed, dir.y * speed, dir.z * speed], j * 3)
      s.to.set([targets.pos[t * 3], targets.pos[t * 3 + 1], targets.pos[t * 3 + 2]], j * 3)
      s.col.set([targets.col[t * 3], targets.col[t * 3 + 1], targets.col[t * 3 + 2]], j * 3)
      s.alpha[j] = 1
      s.size[j] = targets.size
      s.age[j] = 0
      s.life[j] = SHOW.fly + SHOW.hold
      s.grav[j] = Math.random() * Math.PI * 2 // twinkle phase
    }
    sphere(50, 4, GOLD, { life: 1, size: 0.26, trail: 14, trailLife: 0.3 })
    return
  }

  flash(s, x, y, z, a, 9 * power)
  switch (burst) {
    case 'peony':
      // The classic: a clean ball of colour round a heart of another
      sphere(230, 10, a, { life: 2 })
      sphere(60, 4.2, b, { life: 1.5, size: 0.32 })
      break
    case 'chrysanthemum':
      // Like a peony, but every star draws a glowing trail
      sphere(120, 11, a, { life: 2.3, trail: 26, trailLife: 0.55 })
      sphere(40, 4, b, { life: 1.4, size: 0.3 })
      break
    case 'willow':
      // Slow gold stars that hang and weep down in long trails
      sphere(90, 9, GOLD, { life: 4.2, size: 0.3, grav: 0.55, drag: 2.2, trail: 38, trailLife: 1.3 }, 0.2)
      break
    case 'palm':
      // A few thick arms, like a palm tree
      sphere(14, 10.5, GOLD, { life: 2.8, size: 0.46, grav: 0.45, trail: 90, trailLife: 0.9 }, 0.15)
      sphere(40, 2.5, a, { life: 1, size: 0.3 })
      break
    case 'crackle':
      // Silver-gold stars that spit and flicker as they die
      sphere(210, 9.5, Math.random() < 0.5 ? SILVER : GOLD, { life: 2.6, size: 0.34, glitter: true }, 0.35)
      break
    case 'ring': {
      const axis = randomDir().lerp(new THREE.Vector3(0, 0, 1), 0.6).normalize()
      const u = new THREE.Vector3(0, 1, 0).cross(axis).normalize()
      const v = axis.clone().cross(u)
      const n = Math.round(110 * LITE)
      for (let k = 0; k < n; k++) {
        const th = (k / n) * Math.PI * 2
        _d.copy(u).multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th)).multiplyScalar(10.5 * power * STAR_DRAG).add(drift)
        star(s, x, y, z, _d, a, { life: 2.1 })
      }
      sphere(50, 3.5, b, { life: 1.4, size: 0.3 })
      break
    }
    case 'heart': {
      // A heart, facing the plaza
      const pink = new THREE.Color('#ff3d6e').multiplyScalar(1.5)
      const n = Math.round(150 * LITE)
      for (let k = 0; k < n; k++) {
        const th = (k / n) * Math.PI * 2
        const hx = 16 * Math.sin(th) ** 3
        const hy = 13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th)
        _d.set(hx, hy, (Math.random() - 0.5) * 0.6).multiplyScalar(0.5 * power * STAR_DRAG)
        star(s, x, y, z, _d, pink, { life: 2.3, grav: 0.15 })
      }
      break
    }
  }
}

function randomDir() {
  const u = Math.random() * 2 - 1
  const th = Math.random() * Math.PI * 2
  const r = Math.sqrt(1 - u * u)
  return new THREE.Vector3(r * Math.cos(th), u, r * Math.sin(th))
}

// ---------------------------------------------------------------- the message

const targets = { pos: new Float32Array(0), col: new Float32Array(0), count: 0, size: 0.3 }

/**
 * Points tracing the message, laid out to fit the view from `eye`: two lines on
 * a wide screen, three on a narrow (portrait) one.
 */
function layoutMessage(eye: THREE.Vector3, aspect: number, fov: number) {
  const lines = aspect < 1 ? ['Welcome to', 'my heart', 'my love ♥'] : ['Welcome to my heart', 'my love ♥']
  const W = 1024
  const lineH = 150
  const c = document.createElement('canvas')
  c.width = W
  c.height = lineH * lines.length + 40
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Size the font so the widest line fills the canvas
  let font = 140
  ctx.font = `600 ${font}px Georgia, 'Times New Roman', serif`
  const widest = Math.max(...lines.map((l) => ctx.measureText(l.replace('♥', '')).width + (l.includes('♥') ? font : 0)))
  font = Math.min(140, Math.floor((font * (W - 40)) / widest))
  ctx.font = `600 ${font}px Georgia, 'Times New Roman', serif`
  const hearts: [number, number, number][] = []
  lines.forEach((line, k) => {
    const y = 20 + lineH * (k + 0.5)
    if (line.includes('♥')) {
      // Draw the heart ourselves (fonts' hearts vary, emoji are full colour)
      const text = line.replace(' ♥', '')
      const tw = ctx.measureText(text).width
      const hs = font * 0.85
      const x0 = W / 2 - (tw + hs * 1.1) / 2
      ctx.textAlign = 'left'
      ctx.fillText(text, x0, y)
      ctx.textAlign = 'center'
      hearts.push([x0 + tw + hs * 0.65, y, hs])
    } else ctx.fillText(line, W / 2, y)
  })
  ctx.fillStyle = '#f00'
  for (const [hx, hy, hs] of hearts) {
    ctx.beginPath()
    for (let k = 0; k <= 60; k++) {
      const th = (k / 60) * Math.PI * 2
      const px = hx + (16 * Math.sin(th) ** 3 * hs) / 34
      const py = hy - ((13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th)) * hs) / 34
      if (k) ctx.lineTo(px, py)
      else ctx.moveTo(px, py)
    }
    ctx.fill()
  }

  // How wide the message may be in the sky: most of the view across, from where the visitor stands
  const dist = Math.max(12, eye.z - TEXT.z)
  const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect)
  const width = Math.min(30, 2 * dist * Math.tan(hfov / 2) * 0.86)
  const scale = width / W
  const step = 5
  const img = ctx.getImageData(0, 0, c.width, c.height).data
  const pts: number[] = []
  const cols: number[] = []
  const pink = new THREE.Color('#ff3d6e')
  const letter = new THREE.Color('#ffd9a0')
  for (let y = 0; y < c.height; y += step) {
    for (let x = 0; x < W; x += step) {
      const p = (y * W + x) * 4
      if (img[p + 3] < 128) continue
      const jx = (Math.random() - 0.5) * step * 0.6
      const jy = (Math.random() - 0.5) * step * 0.6
      pts.push((x + jx - W / 2) * scale, TEXT.y + (c.height / 2 - y - jy) * scale, TEXT.z + (Math.random() - 0.5) * 0.3)
      const col = img[p + 1] < 128 ? pink : letter
      _c.copy(col).multiplyScalar(1.6) // over-bright: blooms on a computer
      cols.push(_c.r, _c.g, _c.b)
    }
  }
  targets.pos = new Float32Array(pts)
  targets.col = new Float32Array(cols)
  targets.count = pts.length / 3
  targets.size = step * scale * 2.2
  return width
}

// ---------------------------------------------------------------- the show

interface Shot {
  at: number
  x: number
  z: number
  h: number
  burst: Burst
  power: number
}

/**
 * The ordinary show before the message, paced like a real one: single shells
 * to open, pairs, a quick finale — then a breath of dark sky.
 */
function programme(): Shot[] {
  const shots: Shot[] = []
  const fire = (at: number, burst: Burst, x: number, power = 1) =>
    shots.push({ at, burst, power, x: x + (Math.random() - 0.5) * 4, z: -8 - Math.random() * 10, h: (19 + Math.random() * 8) * (0.7 + 0.3 * power) })
  fire(0.6, 'peony', -5)
  fire(2, 'chrysanthemum', 8)
  fire(3.3, 'willow', -10)
  fire(4.4, 'ring', 3)
  fire(5.3, 'palm', 12)
  fire(5.5, 'crackle', -12)
  fire(6.6, 'heart', 0)
  fire(7.3, 'chrysanthemum', -14, 0.8)
  fire(7.5, 'chrysanthemum', 14, 0.8)
  // Finale
  const kinds: Burst[] = ['peony', 'crackle', 'chrysanthemum', 'palm', 'peony', 'willow', 'crackle']
  kinds.forEach((burst, k) => fire(8.4 + k * 0.28, burst, (k / (kinds.length - 1) - 0.5) * 30, 0.85 + Math.random() * 0.3))
  return shots.sort((p, q) => p.at - q.at)
}

/** Once per visit: when the visitor first steps out on to the plaza. */
let shown = false

export function Fireworks() {
  const sim = useMemo(makeSim, [])
  const { camera, gl } = useThree()
  const show = useRef<{ t: number; plan: Shot[]; volley: boolean; tilt: { t: number; from: THREE.Quaternion; to: THREE.Quaternion } | null } | null>(null)
  const messageWidth = useRef(20)

  // The bangs are made ready behind the title screen
  useEffect(() => void audio().prepareFireworks(), [])

  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(sim.pos, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('color', new THREE.BufferAttribute(sim.col, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('alpha', new THREE.BufferAttribute(sim.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('size', new THREE.BufferAttribute(sim.size, 1).setUsage(THREE.DynamicDrawUsage))
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: { scale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float alpha;
        attribute float size;
        uniform float scale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = alpha > 0.0 ? max(1.5, size * scale / -mv.z) : 0.0;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float core = exp(-d * d * 6.0);
          gl_FragColor = vec4(vColor * (core * 1.4 + 0.25 * (1.0 - d)) * vAlpha, 1.0);
        }
      `,
    })
    return { geometry, material }
  }, [sim])

  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  // Development: jump ahead in the show (for screenshots)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    Object.assign(window, {
      __fireworks: {
        skip: (t: number) => {
          const sh = show.current
          if (!sh) return
          sh.t = t
          sh.plan = sh.plan.filter((r) => r.at > t)
        },
      },
    })
  }, [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const st = useMuseum.getState()

    // Start: the first time the visitor is walking on the plaza with the doors still shut
    if (!shown && !show.current && st.mode === 'walking' && st.gate === 'closed' && playerState.position.z > 2) {
      shown = true
      show.current = { t: 0, plan: programme(), volley: false, tilt: lookUp(camera, 0.4) }
    }

    const sh = show.current
    if (sh) {
      sh.t += dt
      while (sh.plan.length && sh.plan[0].at <= sh.t) {
        const r = sh.plan.shift()!
        shell(sim, r.x, r.z, r.h, r.burst, r.power)
      }
      if (!sh.volley && sh.t >= SHOW.volleyAt) {
        sh.volley = true
        const cam = camera as THREE.PerspectiveCamera
        const width = layoutMessage(cam.position, cam.aspect, cam.fov)
        messageWidth.current = width
        // Each rocket carries the part of the message in its slice of the sky
        const order = Array.from({ length: targets.count }, (_, k) => k).sort((p, q) => targets.pos[p * 3] - targets.pos[q * 3])
        for (let r = 0; r < VOLLEY; r++) {
          const cargo = order.slice(Math.floor((r / VOLLEY) * order.length), Math.floor(((r + 1) / VOLLEY) * order.length))
          const x = (r / (VOLLEY - 1) - 0.5) * width * 0.8
          shell(sim, x, TEXT.z - 2, TEXT.y + (r % 2 ? 1.5 : -1), 'letters', 1, cargo)
        }
        // Turn gently to the message, holding it above the visitor's own figure
        sh.tilt = lookAt(camera, new THREE.Vector3(0, TEXT.y - 6.5, TEXT.z))
      }
      // Smaller shells either side of the message while it hangs there
      if (sh.volley && sh.t > SHOW.volleyAt + SHOW.fuse + SHOW.fly && sh.t < SHOW.volleyAt + SHOW.fuse + SHOW.fly + SHOW.hold - 1.5 && Math.random() < dt * 0.8) {
        const side = Math.random() < 0.5 ? -1 : 1
        const kinds: Burst[] = ['heart', 'peony', 'crackle', 'chrysanthemum']
        shell(sim, side * (messageWidth.current / 2 + 5 + Math.random() * 7), -12 - Math.random() * 6, 12 + Math.random() * 12, kinds[Math.floor(Math.random() * kinds.length)], 0.55)
      }
      if (sh.tilt) {
        sh.tilt.t += dt / 2
        const k = Math.min(1, sh.tilt.t)
        camera.quaternion.slerpQuaternions(sh.tilt.from, sh.tilt.to, k * k * (3 - 2 * k))
        if (k >= 1) sh.tilt = null
      }
      if (sh.t > SHOW.volleyAt + SHOW.fuse + SHOW.fly + SHOW.hold + SHOW.fall + 2) show.current = null
    }

    step(sim, dt, camera.position)

    const cam = camera as THREE.PerspectiveCamera
    material.uniforms.scale.value = (gl.domElement.height / 2) / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)
    for (const name of ['position', 'color', 'alpha', 'size']) geometry.getAttribute(name).needsUpdate = true
  })

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />
}

/** Ease the view up by `pitch` (radians), keeping the direction faced. */
function lookUp(camera: THREE.Camera, pitch: number) {
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
  return { t: 0, from: camera.quaternion.clone(), to: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.max(e.x, pitch), e.y, 0, 'YXZ')) }
}

/** Ease the view round to face a point. */
function lookAt(camera: THREE.Camera, at: THREE.Vector3) {
  const m = new THREE.Matrix4().lookAt(camera.position, at, new THREE.Vector3(0, 1, 0))
  return { t: 0, from: camera.quaternion.clone(), to: new THREE.Quaternion().setFromRotationMatrix(m) }
}

function step(s: Sim, dt: number, listener: THREE.Vector3) {
  fireworkGlow.value *= Math.exp(-dt * 7)
  for (let i = 0; i < MAX; i++) {
    const kind = s.kind[i]
    if (kind === Kind.Dead) continue
    s.age[i] += dt
    const a = s.age[i]
    const p = i * 3

    if (kind === Kind.Shell) {
      const slow = Math.exp(-dt * s.drag[i])
      s.vel[p] *= slow
      s.vel[p + 1] *= slow
      s.vel[p + 2] *= slow
      s.pos[p] += s.vel[p] * dt
      s.pos[p + 1] += s.vel[p + 1] * dt
      s.pos[p + 2] += s.vel[p + 2] * dt
      // A thin tail of sparks on the way up
      if (Math.random() < 40 * LITE * dt) ember(s, s.pos[p], s.pos[p + 1], s.pos[p + 2], (Math.random() - 0.5) * 0.5, -1.2, (Math.random() - 0.5) * 0.5, GOLD.r, GOLD.g, GOLD.b, 0.3 + Math.random() * 0.3, 0.16)
      if (a >= s.life[i]) {
        explode(s, i, listener)
        s.kind[i] = Kind.Dead
        s.alpha[i] = 0
        s.burst[i] = null
        s.cargo[i] = null
      }
      continue
    }

    if (kind === Kind.Letter) {
      if (a < SHOW.fly) {
        // Scatter outwards like any burst, then drift in to its place
        const k = a / SHOW.fly
        const e = k * k * (3 - 2 * k)
        const out = (1 - Math.exp(-a * 2.5)) / 2.5
        for (let c = 0; c < 3; c++) {
          const scattered = s.from[p + c] + s.vel[p + c] * out
          s.pos[p + c] = scattered + (s.to[p + c] - scattered) * e
        }
        s.alpha[i] = 1
      } else if (a < s.life[i]) {
        s.pos.set([s.to[p], s.to[p + 1], s.to[p + 2]], p)
        s.alpha[i] = 0.7 + 0.3 * Math.sin(a * 9 + s.grav[i])
      } else {
        // Let go: the message falls away as dying embers
        s.kind[i] = Kind.Ember
        s.base.set([s.col[p], s.col[p + 1], s.col[p + 2]], p)
        s.vel.set([(Math.random() - 0.5) * 0.8, Math.random() * 0.5, (Math.random() - 0.5) * 0.8], p)
        s.age[i] = 0
        s.life[i] = SHOW.fall + Math.random() * 0.8
      }
      continue
    }

    const left = 1 - a / s.life[i]
    if (left <= 0) {
      s.kind[i] = Kind.Dead
      s.alpha[i] = 0
      continue
    }

    if (kind === Kind.Flash) {
      s.alpha[i] = left * left
      continue
    }

    if (kind === Kind.Ember) {
      // Drifts down, cooling from its colour to a dull orange as it fades
      const slow = Math.exp(-dt * 3)
      s.vel[p] *= slow
      s.vel[p + 1] = s.vel[p + 1] * slow + GRAVITY * 0.12 * dt
      s.vel[p + 2] *= slow
      s.pos[p] += s.vel[p] * dt
      s.pos[p + 1] += s.vel[p + 1] * dt
      s.pos[p + 2] += s.vel[p + 2] * dt
      const cool = 1 - left
      s.col[p] = s.base[p] + (1 - s.base[p]) * cool * 0.3
      s.col[p + 1] = s.base[p + 1] * (1 - 0.55 * cool)
      s.col[p + 2] = s.base[p + 2] * (1 - 0.85 * cool)
      s.alpha[i] = left * left
      continue
    }

    // Stars: thrown hard, stopped by the air within a moment, then hanging and drooping
    const slow = Math.exp(-dt * s.drag[i])
    s.vel[p] *= slow
    s.vel[p + 1] = s.vel[p + 1] * slow + GRAVITY * s.grav[i] * dt
    s.vel[p + 2] *= slow
    s.pos[p] += s.vel[p] * dt
    s.pos[p + 1] += s.vel[p + 1] * dt
    s.pos[p + 2] += s.vel[p + 2] * dt
    // White-hot at the burst, settling to its colour
    const hot = Math.max(0, 1 - a / 0.22)
    s.col[p] = s.base[p] + (1.7 - s.base[p]) * hot
    s.col[p + 1] = s.base[p + 1] + (1.7 - s.base[p + 1]) * hot
    s.col[p + 2] = s.base[p + 2] + (1.7 - s.base[p + 2]) * hot
    if (s.glitter[i] && left < 0.55) {
      // Crackle: flashing bright and dark at random as it burns out
      const on = Math.random() < 0.3
      s.alpha[i] = on ? 1.8 : 0.08
      if (on) s.col.set([1.7, 1.6, 1.3], p)
    } else s.alpha[i] = left < 0.25 ? left / 0.25 : 1
    if (s.trail[i] > 0 && Math.random() < s.trail[i] * dt) {
      ember(s, s.pos[p], s.pos[p + 1], s.pos[p + 2], s.vel[p] * 0.08 + (Math.random() - 0.5) * 0.3, s.vel[p + 1] * 0.08, s.vel[p + 2] * 0.08 + (Math.random() - 0.5) * 0.3, s.base[p], s.base[p + 1], s.base[p + 2], s.trailLife[i] * (0.6 + Math.random() * 0.8), s.size[i] * 0.55)
    }
  }
}
