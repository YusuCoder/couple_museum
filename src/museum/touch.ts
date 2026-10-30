/**
 * Phones and tablets: no keyboard, no pointer lock. A thumb stick walks, a
 * drag anywhere else on the scene looks around, a tap does what E does.
 * `?touch` forces this on a desktop (for testing).
 */
export const isTouch =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).has('touch') ||
    (window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0))

/** The thumb stick: x right, y forward, each -1..1 (length ≤ 1). Written by the Hud, read by the Player. */
export const stick = { x: 0, y: 0 }

/** Push the stick this far out to run instead of walk. */
export const RUN_PUSH = 0.92

/** Movement is live: pointer locked on a desktop, always on a touch screen (unless paused). */
export const controlling = () => isTouch || !!document.pointerLockElement
