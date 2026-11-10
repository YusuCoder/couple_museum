import * as THREE from 'three'

import { isTouch } from './touch'

// Phones: bigger audio buffers (fewer wake-ups of the audio thread, so less
// competition with the 3D scene). Must be set before the listener is created.
if (isTouch && typeof AudioContext !== 'undefined') {
  THREE.AudioContext.setContext(new AudioContext({ latencyHint: 'playback' }))
}

/**
 * All museum sound lives on one AudioContext (three's listener context):
 * footsteps + birds + generative music are synthesized; exhibit media
 * (voice notes, films) are PositionalAudio nodes that also feed the reverb.
 */
class AudioEngine {
  readonly listener = new THREE.AudioListener()
  readonly ctx = this.listener.context
  /** Send bus into the room reverb — connect any node here for "in the hall" sound. */
  readonly reverbIn: GainNode
  /** Send bus into a soft repeating echo, as if the voice carried down the gallery (voice notes). */
  readonly echoIn: GainNode

  private noise: AudioBuffer
  private musicBus: GainNode
  private musicInput: AudioNode
  private musicOn = true
  private ducks = new Set<string>()
  private started = false
  private nextChordAt = 0
  /** How far outside the visitor is: birds sing only on the plaza (see setOutdoor). */
  private outdoor = 1
  private nextBirdAt = 0
  /** The couple's own soundtrack; replaces the generated music when set. */
  private track: { el: HTMLAudioElement; node: MediaElementAudioSourceNode } | null = null
  /**
   * Phones: music and footsteps are rendered ahead into plain sound buffers and
   * just played back, instead of being synthesized (or streamed from a media
   * element) live while the 3D scene is drawing.
   */
  private fw: { bursts: AudioBuffer[]; crackles: AudioBuffer[]; launches: AudioBuffer[]; bus: AudioNode } | null = null
  private fwPending = false
  private phone = {
    url: null as string | null,
    song: null as AudioBufferSourceNode | null,
    generated: null as AudioBufferSourceNode | null,
    steps: [] as AudioBuffer[],
  }
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

    // Echo: a delay feeding back into itself through a darkening filter, so each repeat is softer and duller
    this.echoIn = ctx.createGain()
    const delay = ctx.createDelay(1)
    delay.delayTime.value = 0.27
    const dull = ctx.createBiquadFilter()
    dull.type = 'lowpass'
    dull.frequency.value = 2400
    const feedback = ctx.createGain()
    feedback.gain.value = 0.34
    const echoOut = ctx.createGain()
    echoOut.gain.value = 0.38
    this.echoIn.connect(delay).connect(dull).connect(feedback).connect(delay)
    dull.connect(echoOut).connect(out)
    if (!isTouch) echoOut.connect(this.reverbIn)

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
    this.nextChordAt = this.ctx.currentTime + 0.5
    if (isTouch) {
      void this.prerenderSteps()
      if (!this.phone.url) void this.startGeneratedLoop()
    }
    setInterval(() => {
      if (!isTouch) this.scheduleMusic()
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
    if (isTouch) return this.setPhoneTrack(url)
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

  /** Phones: the whole song decoded once, then looped from memory. */
  private setPhoneTrack(url: string | null) {
    const ph = this.phone
    if (url === ph.url) return
    ph.url = url
    ph.song?.stop()
    ph.song = null
    if (!url) {
      if (this.started) void this.startGeneratedLoop()
      this.applyMusicGain()
      return
    }
    ph.generated?.stop()
    ph.generated = null
    this.applyMusicGain()
    void (async () => {
      try {
        const data = await (await fetch(url)).arrayBuffer()
        const buffer = await this.ctx.decodeAudioData(data)
        if (ph.url !== url) return
        const src = this.ctx.createBufferSource()
        src.buffer = buffer
        src.loop = true
        src.connect(this.musicBus)
        src.start()
        ph.song = src
      } catch {
        // Couldn't load it: the museum's own music instead
        if (ph.url === url && this.started) void this.startGeneratedLoop()
      }
    })()
  }

  /** Phones: one full round of the ambient pad rendered offline, looped seamlessly. */
  private async startGeneratedLoop() {
    const ph = this.phone
    if (ph.generated || ph.url) return
    const rate = this.ctx.sampleRate
    const cycle = CHORDS.length * CHORD_LEN
    // Render two rounds and keep the second: it opens with the first round's fading tails, so the loop has no seam
    const off = new OfflineAudioContext(1, Math.ceil(rate * cycle * 2), rate)
    const filter = off.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 2200
    filter.connect(off.destination)
    const chimes = chimePlan()
    for (let round = 0; round < 2; round++) {
      CHORDS.forEach((chord, i) => {
        const t = round * cycle + i * CHORD_LEN
        padChord(off, filter, chord, t)
        for (const c of chimes[i]) chime(off, filter, c.note, t + c.at)
      })
    }
    const rendered = await off.startRendering()
    if (ph.generated || ph.url) return
    const loop = this.ctx.createBuffer(1, Math.ceil(rate * cycle), rate)
    loop.copyToChannel(rendered.getChannelData(0).subarray(Math.ceil(rate * cycle)), 0)
    const src = this.ctx.createBufferSource()
    src.buffer = loop
    src.loop = true
    src.connect(this.musicBus)
    src.start()
    ph.generated = src
  }

  /** Phones: a handful of footsteps made once, picked at random as she walks. */
  private async prerenderSteps() {
    const rate = this.ctx.sampleRate
    for (let i = 0; i < 6; i++) {
      const off = new OfflineAudioContext(1, Math.ceil(rate * 0.16), rate)
      const noise = off.createBuffer(1, this.noise.length, rate)
      noise.copyToChannel(this.noise.getChannelData(0), 0)
      synthStep(off, off.destination, noise, 0, 1)
      this.phone.steps.push(await off.startRendering())
    }
  }

  private applyMusicGain() {
    // A mastered song is much louder than the soft synth pad, so it gets its own level
    const level = this.track || this.phone.url ? 0.07 : 0.012
    // Under a voice note or film the music all but stops, so nothing talks over it
    const target = !this.musicOn ? 0 : this.ducks.size ? level * 0.08 : level
    this.musicBus.gain.setTargetAtTime(target, this.ctx.currentTime, 0.6)
  }

  /** Hard-soled shoe on polished concrete: heel thump + click, then toe click. */
  footstep(intensity: number) {
    if (!this.started) return
    // Barely there: just enough to feel the floor underfoot
    const v = 0.012 * intensity * (0.85 + Math.random() * 0.3)
    const steps = this.phone.steps
    if (isTouch) {
      if (!steps.length) return
      const src = this.ctx.createBufferSource()
      src.buffer = steps[Math.floor(Math.random() * steps.length)]
      const g = this.ctx.createGain()
      g.gain.value = v
      src.connect(g).connect(this.listener.getInput())
      src.start()
      return
    }
    const g = this.ctx.createGain()
    g.gain.value = v
    g.connect(this.listener.getInput())
    g.connect(this.reverbIn)
    synthStep(this.ctx, g, this.noise, this.ctx.currentTime, 1)
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

  /** 1 = on the plaza (birds), 0 = inside (quiet). */
  setOutdoor(f: number) {
    this.outdoor = f
  }

  /**
   * Firework sounds, rendered once ahead of the show (so playing one is just a
   * buffer, even on a phone): a few different shell bursts — the sharp crack,
   * the chest-deep boom, and its echoes rolling back off the buildings — some
   * with a crackling tail, and the thump of a mortar sending a shell up.
   */
  async prepareFireworks() {
    if (this.fw || this.fwPending) return
    this.fwPending = true
    const rate = this.ctx.sampleRate
    const render = async (seconds: number, build: (off: OfflineAudioContext, bus: AudioNode) => void, wet: number) => {
      const off = new OfflineAudioContext(1, Math.ceil(rate * seconds), rate)
      const bus = off.createGain()
      bus.connect(off.destination)
      const air = off.createConvolver()
      air.buffer = outdoorEcho(off, seconds - 0.6)
      const wetGain = off.createGain()
      wetGain.gain.value = wet
      bus.connect(air).connect(wetGain).connect(off.destination)
      build(off, bus)
      const buf = await off.startRendering()
      // Level every sound to the same peak
      const d = buf.getChannelData(0)
      let peak = 0
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]))
      if (peak > 0) for (let i = 0; i < d.length; i++) d[i] *= 0.9 / peak
      return buf
    }
    const white = (off: OfflineAudioContext, seconds: number) => {
      const b = off.createBuffer(1, Math.ceil(rate * seconds), rate)
      const d = b.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
      return b
    }
    /** Noise through a filter with a struck envelope: up in `attack`, away by `end`. */
    const hit = (off: OfflineAudioContext, out: AudioNode, o: { at: number; type: BiquadFilterType; from: number; to?: number; q?: number; gain: number; attack: number; end: number; rate?: number }) => {
      const src = off.createBufferSource()
      src.buffer = white(off, o.end + 0.05)
      src.playbackRate.value = o.rate ?? 1
      const f = off.createBiquadFilter()
      f.type = o.type
      f.Q.value = o.q ?? 0.7
      f.frequency.setValueAtTime(o.from, o.at)
      if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, o.at + o.end * 0.5)
      const g = off.createGain()
      g.gain.setValueAtTime(0, o.at)
      g.gain.linearRampToValueAtTime(o.gain, o.at + o.attack)
      g.gain.exponentialRampToValueAtTime(0.0005, o.at + o.end)
      src.connect(f).connect(g).connect(out)
      src.start(o.at)
      src.stop(o.at + o.end + 0.02)
    }
    const thud = (off: OfflineAudioContext, out: AudioNode, at: number, from: number, to: number, gain: number, end: number) => {
      const osc = off.createOscillator()
      osc.frequency.setValueAtTime(from, at)
      osc.frequency.exponentialRampToValueAtTime(to, at + end * 0.6)
      const g = off.createGain()
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(gain, at + 0.006)
      g.gain.exponentialRampToValueAtTime(0.0005, at + end)
      osc.connect(g).connect(out)
      osc.start(at)
      osc.stop(at + end + 0.02)
    }
    /** A shell bursting: `size` 0 (small, sharp) … 1 (big, deep). */
    const burst = (off: OfflineAudioContext, bus: AudioNode, size: number, body = 1) => {
      const t = 0.02
      hit(off, bus, { at: t, type: 'highpass', from: 900 - size * 400, gain: 0.9, attack: 0.001, end: 0.05 + size * 0.03 })
      hit(off, bus, { at: t, type: 'lowpass', from: 1600 - size * 500, to: 150 - size * 50, gain: 1.3 * body, attack: 0.004, end: 0.6 + size * 0.35 })
      thud(off, bus, t, 95 - size * 25, 38 - size * 8, 0.9 * body, 0.5 + size * 0.3)
    }

    try {
      const bursts = [
        await render(3.6, (off, bus) => burst(off, bus, 0.2), 0.55),
        await render(3.6, (off, bus) => burst(off, bus, 0.6), 0.6),
        await render(3.8, (off, bus) => burst(off, bus, 1), 0.7),
      ]
      const crackles: AudioBuffer[] = []
      for (const size of [0.3, 0.7]) {
        crackles.push(
          await render(
            4,
            (off, bus) => {
              burst(off, bus, size, 0.7)
              // The stars spitting and popping as they burn out, thinning towards the end
              for (let k = 0; k < 110; k++) {
                const at = 0.3 + Math.random() ** 1.6 * 2.1
                hit(off, bus, { at, type: 'bandpass', from: 2200 + Math.random() * 4500, q: 1.6, gain: 0.12 + Math.random() * 0.35, attack: 0.001, end: 0.012 + Math.random() * 0.02, rate: 0.7 + Math.random() })
              }
            },
            0.35,
          ),
        )
      }
      const launches: AudioBuffer[] = []
      for (const v of [0, 1]) {
        launches.push(
          await render(
            2.4,
            (off, bus) => {
              const t = 0.02
              // The mortar's "thoomp", then the shell hissing upwards
              hit(off, bus, { at: t, type: 'lowpass', from: 320 - v * 60, gain: 1, attack: 0.003, end: 0.2 })
              thud(off, bus, t, 125 - v * 15, 46, 0.8, 0.22)
              hit(off, bus, { at: t + 0.08, type: 'bandpass', from: 1500, to: 3400, q: 3.5, gain: 0.06, attack: 0.15, end: 1.2 })
            },
            0.3,
          ),
        )
      }
      // One bus for the whole show, pressed gently so a volley of shells never clips
      const press = this.ctx.createDynamicsCompressor()
      press.threshold.value = -12
      press.ratio.value = 5
      press.attack.value = 0.003
      press.release.value = 0.25
      press.connect(this.listener.getInput())
      this.fw = { bursts, crackles, launches, bus: press }
    } catch {
      // No fireworks sound on this device; the show goes on silently
    }
    this.fwPending = false
  }

  private playFirework(buffer: AudioBuffer, volume: number, delay: number, cutoff: number) {
    if (!this.fw) return
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = buffer
    // No two shells sound quite alike
    src.playbackRate.value = 0.86 + Math.random() * 0.26
    // Distance takes the top off a sound
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = cutoff
    const g = ctx.createGain()
    g.gain.value = volume
    src.connect(lp).connect(g).connect(this.fw.bus)
    src.start(ctx.currentTime + delay)
  }

  /** A mortar sending a shell up. */
  fireworkLaunch(volume: number) {
    if (!this.started || !this.fw) return
    const l = this.fw.launches
    this.playFirework(l[Math.floor(Math.random() * l.length)], 0.4 * volume, 0, 5000)
  }

  /**
   * A shell bursting, heard `delay` seconds later (sound takes its time to
   * arrive). `volume` 0…1 by distance; `crackle`: with a crackling tail.
   */
  fireworkBurst(volume: number, delay: number, crackle: boolean) {
    if (!this.started || !this.fw) return
    const set = crackle ? this.fw.crackles : this.fw.bursts
    this.playFirework(set[Math.floor(Math.random() * set.length)], 0.95 * volume, delay, 2200 + 9500 * volume)
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
    if (this.track) {
      this.nextChordAt = Math.max(this.nextChordAt, ctx.currentTime)
      return
    }
    while (this.nextChordAt < ctx.currentTime + 2) {
      const t = this.nextChordAt
      padChord(ctx, this.musicInput, CHORDS[this.chordIndex % CHORDS.length], t)
      for (const c of chimePlan()[0]) chime(ctx, this.musicInput, c.note, t + c.at)
      this.nextChordAt += CHORD_LEN
      this.chordIndex++
    }
  }
}

const CHORD_LEN = 9
const CHORDS = [
  [48, 55, 59, 62, 64],
  [45, 52, 55, 59, 60],
  [41, 48, 52, 55, 59],
  [43, 50, 52, 55, 59],
]
const CHIMES = [72, 74, 76, 79, 81, 84]

/** Up to three chimes per chord, at random moments. */
function chimePlan() {
  return CHORDS.map(() => {
    const out: { note: number; at: number }[] = []
    for (let i = 0; i < 3; i++) {
      if (Math.random() < 0.35) continue
      out.push({ note: CHIMES[Math.floor(Math.random() * CHIMES.length)], at: 1 + Math.random() * (CHORD_LEN - 2) })
    }
    return out
  })
}

function padChord(ctx: BaseAudioContext, out: AudioNode, chord: number[], t: number) {
  for (const note of chord) {
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
      osc.connect(g).connect(out)
      osc.start(t)
      osc.stop(t + CHORD_LEN + 3)
    }
  }
}

function chime(ctx: BaseAudioContext, out: AudioNode, note: number, at: number) {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = midi(note)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(0.12, at + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0005, at + 3.5)
  osc.connect(g).connect(out)
  osc.start(at)
  osc.stop(at + 3.6)
}

/** Hard-soled shoe on polished concrete: heel thump + click, then toe click (at full level; `out` sets the volume). */
function synthStep(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number, v: number) {
  const click = (at: number, gain: number, freq: number) => {
    const src = ctx.createBufferSource()
    src.buffer = noise
    src.playbackRate.value = 0.8 + Math.random() * 0.4
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = freq
    bp.Q.value = 1.1
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(gain, at + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0008, at + 0.07)
    src.connect(bp).connect(g).connect(out)
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
  thump.connect(tg).connect(out)
  thump.start(t)
  thump.stop(t + 0.1)

  click(t, v, 1100 + Math.random() * 500)
  click(t + 0.04 + Math.random() * 0.015, v * 0.45, 2200 + Math.random() * 600)
}

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12)

/**
 * How a bang sounds outdoors at night: a few distinct echoes off the buildings
 * around, then a long dark rumble rolling away.
 */
function outdoorEcho(ctx: BaseAudioContext, seconds: number) {
  const rate = ctx.sampleRate
  const len = Math.floor(rate * seconds)
  const buf = ctx.createBuffer(1, len, rate)
  const d = buf.getChannelData(0)
  // Rumble: noise with the highs taken off, dying away
  let low = 0
  for (let i = Math.floor(rate * 0.05); i < len; i++) {
    low += 0.07 * (Math.random() * 2 - 1 - low)
    d[i] = low * 2.2 * Math.exp((-i / rate) * 2.4)
  }
  // Slap-backs: each a slightly smeared (duller) copy
  for (const [at, amp] of [
    [0.19, 0.8],
    [0.34, 0.55],
    [0.58, 0.4],
    [0.93, 0.25],
  ]) {
    const i0 = Math.floor(rate * at * (0.9 + Math.random() * 0.2))
    const smear = Math.floor(rate * 0.0012)
    for (let k = 0; k < smear && i0 + k < len; k++) d[i0 + k] += (amp * (1 - k / smear)) / (smear * 0.5)
  }
  return buf
}

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
