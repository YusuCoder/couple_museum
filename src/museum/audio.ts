import * as THREE from 'three'

import { isTouch } from './touch'

// Phones: bigger audio buffers (fewer wake-ups of the audio thread, so less
// competition with the 3D scene). Must be set before the listener is created.
if (isTouch && typeof AudioContext !== 'undefined') {
  THREE.AudioContext.setContext(new AudioContext({ latencyHint: 'playback' }))
}

/**
 * All museum sound lives on one AudioContext (three's listener context):
 * footsteps + room tone + generative music are synthesized; exhibit media
 * (voice notes, films) are PositionalAudio nodes that also feed the reverb.
 */
class AudioEngine {
  readonly listener = new THREE.AudioListener()
  readonly ctx = this.listener.context
  /** Send bus into the room reverb — connect any node here for "in the hall" sound. */
  readonly reverbIn: GainNode

  private noise: AudioBuffer
  private musicBus: GainNode
  private musicInput: AudioNode
  private musicOn = true
  private ducks = new Set<string>()
  private started = false
  private nextChordAt = 0
  /** Indoor hum vs outdoor wind/birds, crossfaded by setOutdoor(). */
  private roomToneGain: GainNode | null = null
  private windGain: GainNode | null = null
  private outdoor = 1
  private nextBirdAt = 0
  /** The couple's own soundtrack; replaces the generated music when set. */
  private track: { el: HTMLAudioElement; node: MediaElementAudioSourceNode } | null = null
  private chordIndex = 0

  constructor() {
    const ctx = this.ctx
    const out = this.listener.getInput()

    this.reverbIn = ctx.createGain()
    const convolver = ctx.createConvolver()
    // A shorter hall on phones: convolution cost grows with the tail length
    convolver.buffer = isTouch ? impulseResponse(ctx, 1.4, 3.2) : impulseResponse(ctx, 2.6, 3.2)
    const reverbOut = ctx.createGain()
    reverbOut.gain.value = 0.32
    this.reverbIn.connect(convolver).connect(reverbOut).connect(out)

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate)
    const data = this.noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    const musicFilter = ctx.createBiquadFilter()
    musicFilter.type = 'lowpass'
    musicFilter.frequency.value = 2200
    this.musicBus = ctx.createGain()
    this.musicBus.gain.value = 0
    musicFilter.connect(this.musicBus)
    this.musicBus.connect(out)
    // Music never falls silent, so on a phone it would keep the reverb working every moment: dry there
    if (!isTouch) this.musicBus.connect(this.reverbIn)
    this.musicInput = musicFilter
  }

  /** Must be called from a user gesture (the Enter button). */
  start() {
    void this.ctx.resume()
    if (this.track && this.musicOn) void this.track.el.play().catch(() => {})
    if (this.started) return
    this.started = true
    this.startRoomTone()
    this.startWind()
    this.nextChordAt = this.ctx.currentTime + 0.5
    setInterval(() => {
      this.scheduleMusic()
      this.scheduleBirds()
    }, 500)
    this.applyMusicGain()
  }

  setMusic(on: boolean) {
    this.musicOn = on
    this.applyMusicGain()
    if (this.track && this.started) {
      if (on) void this.track.el.play().catch(() => {})
      else this.track.el.pause()
    }
  }

  /** Use an uploaded song as the museum soundtrack (null → generated ambient music). */
  setTrack(url: string | null) {
    if (this.track) {
      this.track.el.pause()
      this.track.node.disconnect()
      this.track = null
    }
    if (url) {
      const el = new Audio()
      // Needed for Web Audio to hear cross-origin files (Supabase signed URLs)
      el.crossOrigin = 'anonymous'
      el.src = url
      el.loop = true
      const node = this.ctx.createMediaElementSource(el)
      node.connect(this.musicBus)
      this.track = { el, node }
      if (this.started && this.musicOn) void el.play().catch(() => {})
    }
    this.applyMusicGain()
  }

  /** Leaving the museum page: silence everything until start() is called again. */
  suspend() {
    this.track?.el.pause()
    void this.ctx.suspend()
  }

  /** Lower the music while a voice note or film is playing. */
  duck(key: string, active: boolean) {
    if (active) this.ducks.add(key)
    else this.ducks.delete(key)
    this.applyMusicGain()
  }

  private applyMusicGain() {
    // A mastered song is much louder than the soft synth pad, so it gets its own level
    const level = this.track ? 0.42 : 0.05
    const target = !this.musicOn ? 0 : this.ducks.size ? level * 0.25 : level
    this.musicBus.gain.setTargetAtTime(target, this.ctx.currentTime, 0.6)
  }

  /** Hard-soled shoe on polished concrete: heel thump + click, then toe click. */
  footstep(intensity: number) {
    if (!this.started) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const v = 0.22 * intensity * (0.85 + Math.random() * 0.3)

    const click = (at: number, gain: number, freq: number) => {
      const src = ctx.createBufferSource()
      src.buffer = this.noise
      src.playbackRate.value = 0.8 + Math.random() * 0.4
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = freq
      bp.Q.value = 1.1
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(gain, at + 0.003)
      g.gain.exponentialRampToValueAtTime(0.0008, at + 0.07)
      src.connect(bp).connect(g)
      g.connect(this.listener.getInput())
      g.connect(this.reverbIn)
      src.start(at)
      src.stop(at + 0.1)
    }

    const thump = ctx.createOscillator()
    thump.frequency.setValueAtTime(130, t)
    thump.frequency.exponentialRampToValueAtTime(55, t + 0.06)
    const tg = ctx.createGain()
    tg.gain.setValueAtTime(0, t)
    tg.gain.linearRampToValueAtTime(v * 0.9, t + 0.004)
    tg.gain.exponentialRampToValueAtTime(0.0008, t + 0.08)
    thump.connect(tg).connect(this.listener.getInput())
    thump.start(t)
    thump.stop(t + 0.1)

    click(t, v, 1100 + Math.random() * 500)
    click(t + 0.04 + Math.random() * 0.015, v * 0.45, 2200 + Math.random() * 600)
  }

  /** Very quiet filtered brown noise — the "air" of a big room. */
  private startRoomTone() {
    const ctx = this.ctx
    const len = ctx.sampleRate * 4
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c)
      let last = 0
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
        d[i] = last * 3.5
      }
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 380
    const g = ctx.createGain()
    g.gain.value = 0.05 * (1 - this.outdoor)
    src.connect(lp).connect(g).connect(this.listener.getInput())
    src.start()
    this.roomToneGain = g
  }

  private brownNoise(seconds: number) {
    const ctx = this.ctx
    const len = ctx.sampleRate * seconds
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c)
      let last = 0
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
        d[i] = last * 3.5
      }
    }
    return buf
  }

  /** Soft gusting wind for the plaza. */
  private startWind() {
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.brownNoise(6)
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 420
    bp.Q.value = 0.6
    // Slow gusts
    const gust = ctx.createOscillator()
    gust.frequency.value = 0.09
    const gustDepth = ctx.createGain()
    gustDepth.gain.value = 0.35
    const swell = ctx.createGain()
    swell.gain.value = 0.65
    gust.connect(gustDepth).connect(swell.gain)
    const g = ctx.createGain()
    g.gain.value = 0.12 * this.outdoor
    src.connect(bp).connect(swell).connect(g).connect(this.listener.getInput())
    src.start()
    gust.start()
    this.windGain = g
  }

  /** Short two-note chirps now and then while outside. */
  private scheduleBirds() {
    const ctx = this.ctx
    if (this.outdoor < 0.3) return
    if (this.nextBirdAt > ctx.currentTime + 2) return
    const t = Math.max(this.nextBirdAt, ctx.currentTime + 0.1)
    const base = 2600 + Math.random() * 1600
    const pan = ctx.createStereoPanner()
    pan.pan.value = Math.random() * 1.6 - 0.8
    const g = ctx.createGain()
    g.gain.value = 0.035 * this.outdoor
    pan.connect(g).connect(this.listener.getInput())
    g.connect(this.reverbIn)
    const notes = 2 + Math.floor(Math.random() * 3)
    for (let i = 0; i < notes; i++) {
      const at = t + i * (0.11 + Math.random() * 0.05)
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(base * (1 + Math.random() * 0.15), at)
      osc.frequency.exponentialRampToValueAtTime(base * (0.75 + Math.random() * 0.5), at + 0.08)
      const env = ctx.createGain()
      env.gain.setValueAtTime(0, at)
      env.gain.linearRampToValueAtTime(1, at + 0.01)
      env.gain.exponentialRampToValueAtTime(0.001, at + 0.09)
      osc.connect(env).connect(pan)
      osc.start(at)
      osc.stop(at + 0.1)
    }
    this.nextBirdAt = t + 2.5 + Math.random() * 6
  }

  /** 1 = on the plaza (wind, birds), 0 = inside (gallery hum). */
  setOutdoor(f: number) {
    this.outdoor = f
    const t = this.ctx.currentTime
    this.windGain?.gain.setTargetAtTime(0.12 * f, t, 0.3)
    this.roomToneGain?.gain.setTargetAtTime(0.05 * (1 - f), t, 0.3)
  }

  /** A door swinging shut on its closer: a soft double thud and the latch. `volume`: quieter when it's further away. */
  doorClose(volume = 1) {
    if (!this.started || volume < 0.02) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const out = ctx.createGain()
    out.gain.value = volume
    out.connect(this.listener.getInput())
    out.connect(this.reverbIn)
    for (const [at, gain] of [
      [0, 0.45],
      [0.09, 0.2],
    ] as const) {
      const thud = ctx.createOscillator()
      thud.frequency.setValueAtTime(95, t + at)
      thud.frequency.exponentialRampToValueAtTime(45, t + at + 0.2)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t + at)
      g.gain.linearRampToValueAtTime(gain, t + at + 0.008)
      g.gain.exponentialRampToValueAtTime(0.001, t + at + 0.3)
      thud.connect(g).connect(out)
      thud.start(t + at)
      thud.stop(t + at + 0.35)
    }
    // latch click
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2200
    bp.Q.value = 3
    const lg = ctx.createGain()
    lg.gain.setValueAtTime(0, t + 0.05)
    lg.gain.linearRampToValueAtTime(0.25, t + 0.054)
    lg.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
    src.connect(bp).connect(lg).connect(out)
    src.start(t + 0.05)
    src.stop(t + 0.12)
  }

  /**
   * Door opening: latch clack, the swing, a soft thud at the end. The front
   * door creaks; `soft` doors between rooms just hush open on their closers.
   */
  doorOpen(seconds: number, { soft = false, volume = 1 }: { soft?: boolean; volume?: number } = {}) {
    if (!this.started || volume < 0.02) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const out = ctx.createGain()
    out.gain.value = (soft ? 0.5 : 0.9) * volume
    out.connect(this.listener.getInput())
    out.connect(this.reverbIn)

    const noiseBurst = (at: number, dur: number, freq: number, q: number, gain: number) => {
      const src = ctx.createBufferSource()
      src.buffer = this.noise
      src.loop = true
      const f = ctx.createBiquadFilter()
      f.type = 'bandpass'
      f.frequency.value = freq
      f.Q.value = q
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(gain, at + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0008, at + dur)
      src.connect(f).connect(g).connect(out)
      src.start(at)
      src.stop(at + dur + 0.05)
    }

    // Latch
    noiseBurst(t, 0.06, 1800, 2, 0.5)
    noiseBurst(t + 0.05, 0.08, 900, 2, 0.35)

    // Air rushing through the opening
    noiseBurst(t + 0.4, seconds * 0.7, 500, 0.7, soft ? 0.08 : 0.12)

    if (!soft) {
      // Creak: a buzzy tone whose pitch wobbles as the hinge sticks and slips
      const creak = ctx.createOscillator()
      creak.type = 'sawtooth'
      creak.frequency.setValueAtTime(70, t + 0.25)
      for (let at = t + 0.3; at < t + seconds * 0.8; at += 0.06 + Math.random() * 0.08) {
        creak.frequency.linearRampToValueAtTime(55 + Math.random() * 45, at)
      }
      const body = ctx.createBiquadFilter()
      body.type = 'bandpass'
      body.frequency.value = 1100
      body.Q.value = 7
      const cg = ctx.createGain()
      cg.gain.setValueAtTime(0, t + 0.25)
      cg.gain.linearRampToValueAtTime(0.22, t + 0.6)
      cg.gain.setValueAtTime(0.22, t + seconds * 0.5)
      cg.gain.linearRampToValueAtTime(0, t + seconds * 0.85)
      creak.connect(body).connect(cg).connect(out)
      creak.start(t + 0.25)
      creak.stop(t + seconds)
    }

    // Leaves settling against the wall
    const thudAt = t + seconds * 0.97
    const thud = ctx.createOscillator()
    thud.frequency.setValueAtTime(85, thudAt)
    thud.frequency.exponentialRampToValueAtTime(40, thudAt + 0.25)
    const tg = ctx.createGain()
    tg.gain.setValueAtTime(0, thudAt)
    tg.gain.linearRampToValueAtTime(0.7, thudAt + 0.01)
    tg.gain.exponentialRampToValueAtTime(0.001, thudAt + 0.4)
    thud.connect(tg).connect(out)
    thud.start(thudAt)
    thud.stop(thudAt + 0.45)
    noiseBurst(thudAt, 0.18, 300, 1, 0.3)
  }

  /** Slow, warm ambient pad (Cmaj9 → Am9 → Fmaj7#11 → G6) with sparse chimes. */
  private scheduleMusic() {
    const ctx = this.ctx
    const CHORD_LEN = 9
    const chords = [
      [48, 55, 59, 62, 64],
      [45, 52, 55, 59, 60],
      [41, 48, 52, 55, 59],
      [43, 50, 52, 55, 59],
    ]
    const chimes = [72, 74, 76, 79, 81, 84]
    if (this.track) {
      this.nextChordAt = Math.max(this.nextChordAt, ctx.currentTime)
      return
    }
    while (this.nextChordAt < ctx.currentTime + 2) {
      const t = this.nextChordAt
      for (const note of chords[this.chordIndex % chords.length]) {
        for (const detune of [-6, 6]) {
          const osc = ctx.createOscillator()
          osc.type = 'triangle'
          osc.frequency.value = midi(note)
          osc.detune.value = detune
          const g = ctx.createGain()
          g.gain.setValueAtTime(0, t)
          g.gain.linearRampToValueAtTime(0.09, t + 3)
          g.gain.setValueAtTime(0.09, t + CHORD_LEN - 1)
          g.gain.linearRampToValueAtTime(0, t + CHORD_LEN + 2.5)
          osc.connect(g).connect(this.musicInput)
          osc.start(t)
          osc.stop(t + CHORD_LEN + 3)
        }
      }
      for (let i = 0; i < 3; i++) {
        if (Math.random() < 0.35) continue
        const at = t + 1 + Math.random() * (CHORD_LEN - 2)
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = midi(chimes[Math.floor(Math.random() * chimes.length)])
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, at)
        g.gain.linearRampToValueAtTime(0.12, at + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0005, at + 3.5)
        osc.connect(g).connect(this.musicInput)
        osc.start(at)
        osc.stop(at + 3.6)
      }
      this.nextChordAt += CHORD_LEN
      this.chordIndex++
    }
  }
}

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12)

/** Synthetic stereo impulse response: short pre-delay, exponentially decaying noise. */
function impulseResponse(ctx: BaseAudioContext, seconds: number, decay: number) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const pre = Math.floor(ctx.sampleRate * 0.012)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = pre; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay
  }
  return buf
}

let engine: AudioEngine | null = null
export function audio() {
  return (engine ??= new AudioEngine())
}
