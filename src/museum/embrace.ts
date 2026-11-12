import * as THREE from 'three'

import type { Body } from './body'

/**
 * The couple's embrace, posed on top of the idle clips: his left arm round
 * her waist, her right hand resting on his shoulder, heads leaning in. Mixamo
 * has no two-person clips, so the arms are bent into place each frame with a
 * small two-bone IK after the animation has been applied.
 */

const UP = new THREE.Vector3(0, 1, 0)
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _p = new THREE.Vector3()
const _d = new THREE.Vector3()
const _u = new THREE.Vector3()
const _elbow = new THREE.Vector3()
const _goal = new THREE.Vector3()
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _qd = new THREE.Quaternion()
const _qw = new THREE.Quaternion()
const _qp = new THREE.Quaternion()
const ID = new THREE.Quaternion()

/** Turn `bone` (in world space) so that the point `from` (one of its children) moves towards `to`, by weight w. */
function aim(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, w: number) {
  bone.getWorldPosition(_p)
  _v1.subVectors(from, _p).normalize()
  _v2.subVectors(to, _p).normalize()
  _q.setFromUnitVectors(_v1, _v2)
  _qd.slerpQuaternions(ID, _q, w)
  bone.getWorldQuaternion(_qw)
  _qw.premultiply(_qd)
  bone.parent!.getWorldQuaternion(_qp)
  bone.quaternion.copy(_qp.invert().multiply(_qw))
  bone.updateMatrixWorld(true)
}

/** Bend upper → lower → end so `end` reaches `target`, the elbow/knee bowing towards `pole` (a direction). */
export function twoBoneIK(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, w: number) {
  upper.getWorldPosition(_a)
  lower.getWorldPosition(_b)
  end.getWorldPosition(_c)
  const lab = _a.distanceTo(_b)
  const lbc = _b.distanceTo(_c)
  _d.subVectors(target, _a)
  const dist = THREE.MathUtils.clamp(_d.length(), 0.05, (lab + lbc) * 0.995)
  _d.normalize()
  const cosA = THREE.MathUtils.clamp((lab * lab + dist * dist - lbc * lbc) / (2 * lab * dist), -1, 1)
  const sinA = Math.sqrt(1 - cosA * cosA)
  _u.copy(pole).addScaledVector(_d, -pole.dot(_d))
  if (_u.lengthSq() < 1e-6) _u.copy(UP).addScaledVector(_d, -UP.dot(_d))
  _u.normalize()
  _elbow.copy(_a).addScaledVector(_d, lab * cosA).addScaledVector(_u, lab * sinA)
  _goal.copy(_a).addScaledVector(_d, dist)

  aim(upper, _b, _elbow, w)
  lower.getWorldPosition(_b)
  end.getWorldPosition(_c)
  aim(lower, _c, _goal, w)
}

/** Lean a bone about a world axis (radians, by weight). */
export function lean(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  _q.setFromAxisAngle(axis, angle)
  bone.getWorldQuaternion(_qw)
  _qw.premultiply(_q)
  bone.parent!.getWorldQuaternion(_qp)
  bone.quaternion.copy(_qp.invert().multiply(_qw))
  bone.updateMatrixWorld(true)
}

export interface Rig {
  root: THREE.Object3D
  bone: (name: string) => THREE.Object3D
}

export function makeRig(root: THREE.Object3D): Rig {
  const cache = new Map<string, THREE.Object3D>()
  return {
    root,
    bone: (name) => {
      let b = cache.get(name)
      if (!b) {
        b = root.getObjectByName(name)!
        cache.set(name, b)
      }
      return b
    },
  }
}

/** The avatars currently on stage (skeleton and body), so each can reach for the other. */
export const rigs: { him?: Rig; her?: Rig } = {}
export const bodies: { him?: Body; her?: Body } = {}

const fwd = (yaw: number, out: THREE.Vector3) => out.set(Math.sin(yaw), 0, Math.cos(yaw))
/** Left of someone facing `yaw` (forward = (sin, cos)). */
const left = (yaw: number, out: THREE.Vector3) => out.set(Math.cos(yaw), 0, -Math.sin(yaw))
/** Turn the hand so its fingers (towards `finger`, a knuckle bone) point along `dir`. */
function pointHand(hand: THREE.Object3D, finger: THREE.Object3D | undefined, dir: THREE.Vector3, w: number) {
  if (!finger) return
  hand.getWorldPosition(_a)
  finger.getWorldPosition(_b)
  _c.copy(_a).addScaledVector(dir, _a.distanceTo(_b))
  aim(hand, _b, _c, w)
}

const D = new THREE.Vector3()
const F = new THREE.Vector3()
const L = new THREE.Vector3()
const T = new THREE.Vector3()
const P = new THREE.Vector3()

/** His left arm round her waist; head inclined to her. She stands on his left. */
export function embraceHim(me: Rig, her: Rig, myYaw: number, herYaw: number, w: number) {
  fwd(herYaw, F)
  left(herYaw, L)
  // Hand on the small of her back, a little round towards her far side
  her.bone('Spine').getWorldPosition(T)
  T.addScaledVector(F, -0.12).addScaledVector(L, 0.07)
  T.y -= 0.02
  fwd(myYaw, F)
  left(myYaw, L)
  // Elbow goes back and out, behind her
  P.copy(F).multiplyScalar(-1).addScaledVector(L, 0.4).addScaledVector(UP, -0.5)
  twoBoneIK(me.bone('LeftArm'), me.bone('LeftForeArm'), me.bone('LeftHand'), T, P, w)
  lean(me.bone('Head'), F, -0.06 * w)
}

/** Her right hand resting on his left shoulder; head leaning on towards him. He stands on her right. */
export function embraceHer(me: Rig, him: Rig, myYaw: number, hisYaw: number, w: number) {
  fwd(hisYaw, F)
  left(hisYaw, L)
  // On top of his shoulder, towards the front and in from the point of it
  him.bone('LeftArm').getWorldPosition(T)
  T.addScaledVector(F, 0.03).addScaledVector(L, -0.07)
  T.y += 0.1
  // Fingers over the shoulder, towards his back
  D.copy(F).multiplyScalar(-0.7).addScaledVector(UP, -0.55).normalize()
  fwd(myYaw, F)
  left(myYaw, L)
  // Elbow down, a little forward and out to her right
  P.copy(UP).multiplyScalar(-1).addScaledVector(F, 0.6).addScaledVector(L, -0.3)
  twoBoneIK(me.bone('RightArm'), me.bone('RightForeArm'), me.bone('RightHand'), T, P, w)
  pointHand(me.bone('RightHand'), me.bone('RightHandMiddle1'), D, w)
  // Tilt the head to her right, towards his shoulder
  lean(me.bone('Neck'), F, 0.1 * w)
  lean(me.bone('Head'), F, 0.12 * w)
}

const S1 = new THREE.Vector3()
const S2 = new THREE.Vector3()
const H1 = new THREE.Vector3()
const H2 = new THREE.Vector3()

/** Shoulder to wrist with the arm out straight. */
function armLength(rig: Rig, side: 'Left' | 'Right') {
  rig.bone(`${side}Arm`).getWorldPosition(_a)
  rig.bone(`${side}ForeArm`).getWorldPosition(_b)
  rig.bone(`${side}Hand`).getWorldPosition(_c)
  return _a.distanceTo(_b) + _b.distanceTo(_c)
}

/**
 * Walking hand in hand: the arm on the partner's side reaches down and across
 * to meet theirs half-way between the two shoulders, as low as both can reach
 * comfortably. Each figure poses its own arm; both work out the same meeting
 * point, so the hands join.
 */
export function holdHands(me: Rig, other: Rig, myYaw: number, w: number) {
  me.bone('Hips').getWorldPosition(H1)
  other.bone('Hips').getWorldPosition(H2)
  fwd(myYaw, F)
  left(myYaw, L)
  D.subVectors(H2, H1).setY(0)
  const side = D.dot(L) > 0 ? 'Left' : 'Right'
  me.bone(`${side}Arm`).getWorldPosition(S1)
  // Their arm on my side: the shoulder nearer to me
  const theirs = other.bone('LeftArm').getWorldPosition(S2).distanceToSquared(H1) < other.bone('RightArm').getWorldPosition(T).distanceToSquared(H1) ? 'Left' : 'Right'
  other.bone(`${theirs}Arm`).getWorldPosition(S2)

  const half = Math.hypot(S2.x - S1.x, S2.z - S1.z) / 2
  // Elbows a little bent, not locked
  const drop = (reach: number) => Math.sqrt(Math.max((reach * 0.9) ** 2 - half * half, 0.0004))
  const y = Math.max(S1.y - drop(armLength(me, side)), S2.y - drop(armLength(other, theirs)))
  D.subVectors(S2, S1).setY(0).normalize()
  // My wrist stops just short of the middle, where the two palms meet
  T.set((S1.x + S2.x) / 2, y, (S1.z + S2.z) / 2).addScaledVector(D, -0.045)
  // Elbow behind and a touch out
  P.copy(F).multiplyScalar(-1).addScaledVector(D, -0.25).addScaledVector(UP, -0.2)
  twoBoneIK(me.bone(`${side}Arm`), me.bone(`${side}ForeArm`), me.bone(`${side}Hand`), T, P, w)
  // Fingers down and round the other's hand
  _u.copy(D).multiplyScalar(0.55).addScaledVector(UP, -0.8).addScaledVector(F, 0.1).normalize()
  pointHand(me.bone(`${side}Hand`), me.bone(`${side}HandMiddle1`), _u, w)
}
