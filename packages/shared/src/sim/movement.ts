// Deterministic movement & collision simulation, shared by client (prediction) and server.
// Capsule player (radius r, height h) vs AABB world boxes. Character-controller style:
// horizontal move with axis-separated AABB sweep, then vertical with ground detection.
import { ACCEL_AIR, ACCEL_GROUND, CROUCH_SPEED, FRICTION_GROUND, GRAVITY, JUMP_SPEED, MOVE_SPEED, PLAYER_CROUCH_HEIGHT, PLAYER_HEIGHT, PLAYER_RADIUS, WALK_SPEED } from '../config/constants.js';
import type { InputCmd } from '../protocol/messages.js';

export interface AABB { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

export interface PlayerSimState {
  x: number; y: number; z: number;   // feet position
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  crouch: boolean;
  grounded: boolean;
  height: number;
}

export const newPlayerSimState = (x: number, y: number, z: number): PlayerSimState => ({
  x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, crouch: false, grounded: true, height: PLAYER_HEIGHT,
});

/** Minimum translation vector on Y axis if AABBs overlap; null if not overlapping. */
function overlap(a: AABB, px: number, py: number, pz: number, r: number, h: number): AABB | null {
  const minX = px - r, maxX = px + r;
  const minY = py, maxY = py + h;
  const minZ = pz - r, maxZ = pz + r;
  if (maxX <= a.minX || minX >= a.maxX) return null;
  if (maxY <= a.minY || minY >= a.maxY) return null;
  if (maxZ <= a.minZ || minZ >= a.maxZ) return null;
  return a;
}

export function collidesAt(box: AABB, px: number, py: number, pz: number, r: number, h: number): AABB | null {
  for (const a of box ? [box] : []) if (overlap(a, px, py, pz, r, h)) return a;
  return null;
}

/** Move player one tick. `boxes` = all solid AABBs. dt in seconds. */
export function stepMovement(p: PlayerSimState, cmd: InputCmd, boxes: AABB[], dt: number): void {
  const targetH = cmd.crouch ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
  p.crouch = cmd.crouch;
  // only stand up if no ceiling
  if (p.height < targetH) {
    let blocked = false;
    for (const a of boxes) {
      if (overlap(a, p.x, p.y, p.z, PLAYER_RADIUS, targetH)) { blocked = true; break; }
    }
    if (!blocked) p.height = targetH;
  } else p.height = targetH;

  p.yaw = cmd.yaw;
  p.pitch = cmd.pitch;

  const speed = p.crouch ? CROUCH_SPEED : (cmd.walk ? WALK_SPEED : MOVE_SPEED);
  // desired horizontal velocity in world space from yaw
  const sin = Math.sin(cmd.yaw), cos = Math.cos(cmd.yaw);
  const fwdX = -sin, fwdZ = -cos;
  const rightX = cos, rightZ = -sin;
  let wishX = fwdX * cmd.moveZ + rightX * cmd.moveX;
  let wishZ = fwdZ * cmd.moveZ + rightZ * cmd.moveX;
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 1) { wishX /= wishLen; wishZ /= wishLen; }

  if (p.grounded) {
    // friction
    const f = Math.max(0, 1 - FRICTION_GROUND * dt);
    p.vx *= f; p.vz *= f;
    // accelerate toward wish (accel scaled to friction so top speed == `speed`)
    p.vx += wishX * speed * FRICTION_GROUND * dt;
    p.vz += wishZ * speed * FRICTION_GROUND * dt;
    const hv = Math.hypot(p.vx, p.vz);
    if (hv > speed) { p.vx *= speed / hv; p.vz *= speed / hv; }
    if (cmd.jump) { p.vy = JUMP_SPEED; p.grounded = false; }
  } else {
    p.vx += wishX * ACCEL_AIR * dt;
    p.vz += wishZ * ACCEL_AIR * dt;
    const hv = Math.hypot(p.vx, p.vz);
    if (hv > speed) { p.vx *= speed / hv; p.vz *= speed / hv; }
  }

  // vertical
  p.vy -= GRAVITY * dt;
  p.y += p.vy * dt;
  p.grounded = false;
  for (const a of boxes) {
    if (overlap(a, p.x, p.y, p.z, PLAYER_RADIUS, p.height)) {
      // resolve vertically: simplest — push up on floor-like tops
      if (p.vy <= 0 && a.maxY <= p.y + p.height * 0.5) {
        p.y = a.maxY; p.vy = 0; p.grounded = true;
      } else if (p.vy > 0) {
        p.y = a.minY - p.height; p.vy = 0;
      }
    }
  }

  // horizontal, axis-separated with simple blocking
  moveAxis(p, cmd.moveX !== 0 || true, p.x + p.vx * dt, boxes, 'x');
  moveAxisZ(p, p.z + p.vz * dt, boxes);
}

function sweepBlocked(p: PlayerSimState, nx: number, nz: number, boxes: AABB[]): boolean {
  for (const a of boxes) if (overlap(a, nx, p.y, nz, PLAYER_RADIUS, p.height)) return true;
  return false;
}

function moveAxis(p: PlayerSimState, _t: boolean, nx: number, boxes: AABB[], _axis: 'x'): void {
  if (!sweepBlocked(p, nx, p.z, boxes)) { p.x = nx; p.vx = p.vx; }
  else {
    // try step-up (stairs) by 0.5
    const stepY = p.y + 0.5;
    let ok = true;
    for (const a of boxes) if (overlap(a, nx, stepY, p.z, PLAYER_RADIUS, p.height)) { ok = false; break; }
    if (ok) { p.x = nx; p.y = stepY; }
    else p.vx = 0;
  }
}

function moveAxisZ(p: PlayerSimState, nz: number, boxes: AABB[]): void {
  if (!sweepBlocked(p, p.x, nz, boxes)) { p.z = nz; }
  else {
    const stepY = p.y + 0.5;
    let ok = true;
    for (const a of boxes) if (overlap(a, p.x, stepY, nz, PLAYER_RADIUS, p.height)) { ok = false; break; }
    if (ok) { p.z = nz; p.y = stepY; }
    else p.vz = 0;
  }
}
