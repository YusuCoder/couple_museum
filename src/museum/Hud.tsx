import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

import type { Exhibit } from './exhibits'
import { exitView, interact, lockPointer, pause, stepView, toggleMusic, toggleView } from './Interaction'
import { standUp } from './Seats'
import { exhibitRegistry, useMuseum } from './store'
import { isTouch, stick } from './touch'

/** How to trigger an action: a key on a desktop, a tap on a phone. */
const ACT = isTouch ? 'Tap here' : null

/** Bottom-left thumb stick (touch screens): writes `stick` for the Player. */
function Stick() {
  const base = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  const id = useRef<number | null>(null)
  const R = 46
  // Leaving walking mid-push (an exhibit, the pause screen) must not leave the visitor walking
  useEffect(
    () => () => {
      stick.x = stick.y = 0
    },
    [],
  )
  const move = (e: React.PointerEvent) => {
    if (e.pointerId !== id.current) return
    const r = base.current!.getBoundingClientRect()
    let dx = e.clientX - (r.left + r.width / 2)
    let dy = e.clientY - (r.top + r.height / 2)
    const len = Math.hypot(dx, dy)
    if (len > R) {
      dx *= R / len
      dy *= R / len
    }
    stick.x = dx / R
    stick.y = -dy / R
    knob.current!.style.transform = `translate(${dx}px, ${dy}px)`
  }
  const end = (e: React.PointerEvent) => {
    if (e.pointerId !== id.current) return
    id.current = null
    stick.x = stick.y = 0
    knob.current!.style.transform = ''
  }
  return (
    <div
      ref={base}
      className="stick"
      onPointerDown={(e) => {
        if (id.current !== null) return
        id.current = e.pointerId
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // Capture refused (e.g. the pointer is locked): the stick still follows moves over it
        }
        move(e)
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div ref={knob} className="stick-knob" />
    </div>
  )
}

/** Top-right buttons (touch screens): the keys a phone doesn't have. */
function TouchBar() {
  const music = useMuseum((s) => s.music)
  const view = useMuseum((s) => s.view)
  return (
    <div className="touch-bar">
      <button className="round" onClick={toggleView} aria-label={view === 'third' ? 'First person' : 'Show character'}>
        {view === 'third' ? '👁' : '🧍'}
      </button>
      <button className="round" onClick={toggleMusic} aria-label={music ? 'Music off' : 'Music on'}>
        <span className={music ? undefined : 'round-off'}>♪</span>
      </button>
      <button className="round" onClick={pause} aria-label="Pause">
        ❙❙
      </button>
    </div>
  )
}

/** The "press E" card; on a touch screen the card itself is the button. */
function Prompt({ title, sub, action, onTap }: { title?: string; sub?: string | null; action: string; onTap: () => void }) {
  return (
    <div className={`prompt${isTouch ? ' prompt--tap' : ''}`} onClick={isTouch ? onTap : undefined}>
      {title && <span className="prompt-title">{title}</span>}
      {sub && <span className="prompt-sub">{sub}</span>}
      <span>
        {ACT ?? (
          <>
            <kbd>E</kbd> or click
          </>
        )}
        {action && ` ${action}`}
      </span>
    </div>
  )
}

function mediaLabel(ex?: Exhibit) {
  return ex?.voice ? '♪ voice note' : ex?.video ? '▶ film' : null
}

export function Hud() {
  const mode = useMuseum((s) => s.mode)
  const focusedId = useMuseum((s) => s.focusedId)
  const viewingId = useMuseum((s) => s.viewingId)
  const music = useMuseum((s) => s.music)
  const view = useMuseum((s) => s.view)
  const nearGate = useMuseum((s) => s.nearGate)
  const nearDoor = useMuseum((s) => s.nearDoor)
  const nearSeat = useMuseum((s) => s.nearSeat)
  const exhibits = useMuseum((s) => s.exhibits)
  const names = useMuseum((s) => s.names)
  const byId = new Map(exhibits.map((e) => [e.id, e]))

  if (mode === 'intro') {
    return (
      <div className="overlay">
        <h1>Our Story</h1>
        <p>{names ? `${names} — a museum of the moments that made us.` : 'A museum of the moments that made us.'}</p>
        <button onClick={lockPointer}>Enter the museum</button>
        {isTouch ? (
          <p className="hint">Left thumb walks (push all the way to run) · drag to look around · tap a photo to see it · Best with headphones</p>
        ) : (
        <p className="hint">
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> walk · <kbd>Mouse</kbd> look · <kbd>Shift</kbd> faster · <kbd>E</kbd> view exhibit · Best with headphones
        </p>
        )}
      </div>
    )
  }

  if (mode === 'paused') {
    return (
      <div className="overlay overlay--paused" onClick={lockPointer}>
        <p className="paused-title">Paused</p>
        <p>{isTouch ? 'Tap anywhere' : 'Click anywhere'} to continue walking</p>
        <button
          className="chip"
          onClick={(e) => {
            e.stopPropagation()
            toggleMusic()
          }}
        >
          Music: {music ? 'on' : 'off'}
        </button>
        <Link className="chip" to="/" onClick={(e) => e.stopPropagation()}>
          Edit museum
        </Link>
      </div>
    )
  }

  if (mode === 'viewing' && viewingId) {
    const ex = byId.get(viewingId)!
    const media = mediaLabel(ex)
    return (
      <div className="caption">
        <p className="caption-date">{ex.date}</p>
        <h2>{ex.title}</h2>
        <p className="caption-text">{ex.caption}</p>
        <div className="caption-actions">
          <button className="chip" onClick={() => stepView(-1)} aria-label="Previous exhibit">
            ‹ Prev
          </button>
          {media && (
            <button className="chip" onClick={() => exhibitRegistry.get(viewingId)?.replay?.()}>
              Replay {media}
            </button>
          )}
          <button className="chip chip--primary" onClick={() => exitView(true)}>
            Back to walking
          </button>
          <button className="chip" onClick={() => stepView(1)} aria-label="Next exhibit">
            Next ›
          </button>
        </div>
        {!isTouch && <p className="caption-keys">
          <kbd>←</kbd>
          <kbd>→</kbd> browse · <kbd>E</kbd> back
        </p>}
      </div>
    )
  }

  // walking / returning / sitting
  const focused = focusedId ? byId.get(focusedId) : undefined
  return (
    <>
      {mode !== 'sitting' && <div className={`crosshair${focusedId ? ' crosshair--focus' : ''}`} />}
      {mode === 'walking' && !focusedId && !nearDoor && !nearGate && nearSeat && (
        <Prompt title="Sit down" action="" onTap={interact} />
      )}
      {mode === 'walking' && !focusedId && nearDoor && (
        <Prompt title="Open the door" sub={nearDoor.label} action="" onTap={interact} />
      )}
      {mode === 'walking' && !focusedId && nearGate && <Prompt title="Open the doors" action="" onTap={interact} />}
      {mode === 'walking' && focused && (
        <Prompt title={focused.title} sub={mediaLabel(focused)} action={isTouch ? '' : 'to view'} onTap={interact} />
      )}
      {isTouch && mode === 'sitting' && <Prompt title="Stand up" action="" onTap={standUp} />}
      {isTouch ? (
        <>
          {(mode === 'walking' || mode === 'sitting') && <Stick />}
          <TouchBar />
        </>
      ) : (
        <div className="corner-hint">
          {mode === 'sitting' && (
            <>
              <kbd>E</kbd> stand up ·{' '}
            </>
          )}
          <kbd>V</kbd> {view === 'third' ? 'first person' : 'show character'} · <kbd>M</kbd> music {music ? 'on' : 'off'} ·{' '}
          <kbd>Esc</kbd> pause
        </div>
      )}
    </>
  )
}
