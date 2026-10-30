import * as THREE from 'three'

function canvasTexture(canvas: HTMLCanvasElement) {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** Painterly placeholder "photo": gradient, soft bokeh, film grain. */
export function placeholderPhoto(title: string, aspect: number, [c1, c2]: [string, string]) {
  const h = 768
  const w = Math.round(h * aspect)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  const grad = ctx.createLinearGradient(0, 0, w * 0.4, h)
  grad.addColorStop(0, c1)
  grad.addColorStop(1, c2)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  // Deterministic pseudo-random from title so each exhibit stays the same
  let seed = [...title].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)

  ctx.globalCompositeOperation = 'screen'
  for (let i = 0; i < 26; i++) {
    const x = rand() * w
    const y = rand() * h
    const r = 20 + rand() * h * 0.18
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(255,255,255,${0.12 + rand() * 0.25})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // Two silhouettes, so placeholders read as "a couple's photo"
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = 'rgba(30,20,40,0.55)'
  const base = h * 0.98
  for (const [cx, s] of [[w * 0.44, 1], [w * 0.57, 0.92]] as const) {
    ctx.beginPath()
    ctx.arc(cx, base - h * 0.5 * s, h * 0.075 * s, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(cx, base - h * 0.12 * s, h * 0.13 * s, h * 0.3 * s, 0, Math.PI, 0)
    ctx.fill()
  }

  ctx.globalCompositeOperation = 'source-over'
  const img = ctx.getImageData(0, 0, w, h)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 18
    img.data[i] += n
    img.data[i + 1] += n
    img.data[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)

  return canvasTexture(canvas)
}

/** Engraved brass museum label. */
export function plaqueTexture(title: string, date: string, caption: string, badge?: string) {
  const w = 1024
  const h = 384
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  const grad = ctx.createLinearGradient(0, 0, w, h)
  grad.addColorStop(0, '#c9a35a')
  grad.addColorStop(0.5, '#e6c987')
  grad.addColorStop(1, '#b38b45')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  // Brushed-metal streaks
  for (let y = 0; y < h; y += 2) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`
    ctx.fillRect(0, y, w, 1)
  }

  ctx.fillStyle = '#3b2a12'
  ctx.textBaseline = 'top'
  ctx.font = '600 64px Georgia, "Times New Roman", serif'
  ctx.fillText(title, 56, 50, w - 112)
  ctx.font = 'italic 40px Georgia, "Times New Roman", serif'
  ctx.fillText(date, 56, 140, w - 112)
  ctx.font = '36px Georgia, "Times New Roman", serif'
  wrap(ctx, caption, 56, 215, w - 112, 46)
  if (badge) {
    ctx.font = 'italic 30px Georgia, "Times New Roman", serif'
    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(59,42,18,0.75)'
    ctx.fillText(badge, w - 56, h - 62)
  }

  return canvasTexture(canvas)
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  let line = ''
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y)
      line = word
      y += lh
    } else line = test
  }
  ctx.fillText(line, x, y)
}

/** Large title painted on the entrance wall. */
export function wallTitleTexture(title: string, subtitle: string, light = false) {
  const w = 2048
  const h = 640
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  // Dark ink on pale walls, warm light lettering on dark ones
  ctx.fillStyle = light ? '#efe6d6' : '#2a2420'
  ctx.textAlign = 'center'
  ctx.font = '300 190px Georgia, "Times New Roman", serif'
  ctx.fillText(title, w / 2, 300, w - 80)
  ctx.font = 'italic 70px Georgia, "Times New Roman", serif'
  ctx.fillStyle = light ? '#c9b597' : '#6b5e52'
  ctx.fillText(subtitle, w / 2, 460)
  const tex = canvasTexture(canvas)
  return tex
}

/** Polished warm concrete: low-frequency clouds + fine speckle. Tileable enough at this scale. */
export function concreteTexture() {
  const s = 1024
  const canvas = document.createElement('canvas')
  canvas.width = s
  canvas.height = s
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#9a8f84'
  ctx.fillRect(0, 0, s, s)
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * s
    const y = Math.random() * s
    const r = 30 + Math.random() * 120
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const light = Math.random() > 0.5
    g.addColorStop(0, light ? 'rgba(255,248,238,0.035)' : 'rgba(40,30,20,0.035)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  const img = ctx.getImageData(0, 0, s, s)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14
    img.data[i] += n
    img.data[i + 1] += n
    img.data[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
  // Saw-cut joints between slabs (texture edges)
  ctx.fillStyle = 'rgba(30,24,18,0.35)'
  ctx.fillRect(0, 0, s, 3)
  ctx.fillRect(0, 0, 3, s)
  const tex = canvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2, 6)
  return tex
}

function seeded(seed: number) {
  let s = seed >>> 0
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, rand: () => number) {
  const img = ctx.getImageData(0, 0, w, h)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * amount
    img.data[i] += n
    img.data[i + 1] += n
    img.data[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
}

function tiled(canvas: HTMLCanvasElement) {
  const tex = canvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

/** Light stone pavers in a running bond, 5 × 5 per tile (tile size set by the caller's repeat). */
export function paverTexture() {
  const s = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = s
  const ctx = canvas.getContext('2d')!
  const rand = seeded(11)
  const p = s / 5
  for (let row = 0; row < 5; row++) {
    const off = row % 2 ? p / 2 : 0
    for (let col = -1; col < 6; col++) {
      const l = 168 + rand() * 26
      ctx.fillStyle = `rgb(${l + 6},${l + 2},${l - 8})`
      ctx.fillRect(col * p + off, row * p, p, p)
    }
  }
  ctx.fillStyle = 'rgba(70,64,56,0.8)'
  for (let row = 0; row <= 5; row++) ctx.fillRect(0, row * p - 2, s, 4)
  for (let row = 0; row < 5; row++) {
    const off = row % 2 ? p / 2 : 0
    for (let col = 0; col <= 5; col++) ctx.fillRect(col * p + off - 2, row * p, 4, p)
  }
  grain(ctx, s, s, 22, rand)
  return tiled(canvas)
}

/** Lawn / hedge foliage: mottled greens. */
export function foliageTexture(base = '#4c6b34') {
  const s = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = s
  const ctx = canvas.getContext('2d')!
  const rand = seeded(base.length * 97)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, s, s)
  for (let i = 0; i < 2600; i++) {
    const x = rand() * s
    const y = rand() * s
    const r = 1 + rand() * 5
    ctx.fillStyle = rand() > 0.5 ? 'rgba(20,40,10,0.35)' : 'rgba(150,180,90,0.22)'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  return tiled(canvas)
}

/** Small painted sign above a doorway: "Next · II · Our wedding". */
export function doorSignTexture(kicker: string, title: string) {
  const w = 1024
  const h = 256
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(232,214,180,0.85)'
  ctx.font = '500 34px system-ui, sans-serif'
  ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '8px'
  ctx.fillText(kicker.toUpperCase(), w / 2, 92)
  ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px'
  ctx.fillStyle = '#f4ece0'
  ctx.font = 'italic 76px Georgia, "Times New Roman", serif'
  ctx.fillText(title, w / 2, 182, w - 60)
  return canvasTexture(canvas)
}

/** Board-formed architectural concrete: warm pale grey, horizontal board marks, tie holes. One tile = 4 × 4 m. */
export function facadeConcreteTexture() {
  const s = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = s
  const ctx = canvas.getContext('2d')!
  const rand = seeded(2024)
  const boards = 16 // 25 cm boards
  const bh = s / boards
  for (let i = 0; i < boards; i++) {
    const l = 206 + rand() * 12
    ctx.fillStyle = `rgb(${l + 4},${l},${l - 6})`
    ctx.fillRect(0, i * bh, s, bh)
    // grain of the formwork timber
    for (let k = 0; k < 14; k++) {
      ctx.fillStyle = `rgba(${rand() > 0.5 ? '255,255,250' : '120,112,100'},${0.04 + rand() * 0.05})`
      ctx.fillRect(rand() * s, i * bh + rand() * bh, 80 + rand() * 300, 1 + rand() * 2)
    }
    ctx.fillStyle = 'rgba(110,102,92,0.35)'
    ctx.fillRect(0, i * bh, s, 1.5)
  }
  // Panel joints every 2 m and tie holes on a 50 cm grid
  ctx.fillStyle = 'rgba(90,84,76,0.55)'
  ctx.fillRect(0, s / 2 - 1, s, 2)
  ctx.fillRect(s / 2 - 1, 0, 2, s)
  for (let y = s / 16; y < s; y += s / 8) {
    for (let x = s / 16; x < s; x += s / 8) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 7)
      g.addColorStop(0, 'rgba(70,64,58,0.8)')
      g.addColorStop(1, 'rgba(70,64,58,0)')
      ctx.fillStyle = g
      ctx.fillRect(x - 8, y - 8, 16, 16)
    }
  }
  // Soft weathering
  for (let i = 0; i < 60; i++) {
    const x = rand() * s
    const y = rand() * s
    const g = ctx.createRadialGradient(x, y, 0, x, y, 60 + rand() * 120)
    g.addColorStop(0, `rgba(${rand() > 0.5 ? '255,250,240' : '90,84,76'},0.05)`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - 180, y - 180, 360, 360)
  }
  grain(ctx, s, s, 12, rand)
  return tiled(canvas)
}

/** Brass letters on a transparent background, for signage. */
export function brassLettersTexture(lines: { text: string; size: number; spacing?: number; italic?: boolean; weight?: number }[], w = 2048, h = 512) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const total = lines.reduce((a, l) => a + l.size * 1.4, 0)
  let y = (h - total) / 2
  for (const line of lines) {
    y += (line.size * 1.4) / 2
    ctx.font = `${line.italic ? 'italic ' : ''}${line.weight ?? 400} ${line.size}px "Cormorant Garamond", Georgia, serif`
    ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${line.spacing ?? 0}px`
    const g = ctx.createLinearGradient(0, y - line.size / 2, 0, y + line.size / 2)
    g.addColorStop(0, '#f1d89a')
    g.addColorStop(0.5, '#c9a35a')
    g.addColorStop(1, '#8f6d33')
    ctx.fillStyle = g
    ctx.fillText(line.text, w / 2, y)
    y += (line.size * 1.4) / 2
  }
  return canvasTexture(canvas)
}
