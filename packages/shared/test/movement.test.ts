import { describe, it, expect } from 'vitest';
import { stepMovement, newPlayerSimState, type AABB } from '../src/sim/movement.js';
import { GRAVITY, MOVE_SPEED, TICK_MS } from '../src/config/constants.js';
import type { InputCmd } from '../src/protocol/messages.js';

const DT = TICK_MS / 1000;
const cmd = (over: Partial<InputCmd> = {}): InputCmd => ({
  seq: 1, tick: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
  jump: false, crouch: false, walk: false, fire: false, reload: false, weaponSlot: null, ...over,
});

const floor: AABB = { minX: -50, minY: -1, minZ: -50, maxX: 50, maxY: 0, maxZ: 50 };
const wall: AABB = { minX: -1, minY: 0, minZ: -10, maxX: 1, maxY: 3, maxZ: 10 };

describe('movement determinism & basics', () => {
  it('falls to the floor and lands', () => {
    const p = newPlayerSimState(0, 3, 0);
    for (let i = 0; i < 200; i++) stepMovement(p, cmd(), [floor], DT);
    expect(p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(0, 2);
  });

  it('moves forward at expected speed', () => {
    const p = newPlayerSimState(0, 0, 0);
    for (let i = 0; i < 60; i++) stepMovement(p, cmd({ moveZ: 1 }), [floor], DT);
    expect(Math.hypot(p.vx, p.vz)).toBeCloseTo(MOVE_SPEED, 1);
    expect(p.z).toBeLessThan(-5); // forward = -Z at yaw 0
  });

  it('does not walk through a wall', () => {
    const p = newPlayerSimState(0, 0, 0);
    for (let i = 0; i < 300; i++) stepMovement(p, cmd({ moveZ: 1 }), [floor, wall], DT);
    expect(p.z).toBeGreaterThanOrEqual(wall.minZ - 0.5);
  });

  it('is deterministic for identical inputs', () => {
    const a = newPlayerSimState(0, 0, 0);
    const b = newPlayerSimState(0, 0, 0);
    for (let i = 0; i < 120; i++) {
      stepMovement(a, cmd({ moveX: 1, moveZ: 1, yaw: i * 0.01, jump: i === 10 }), [floor, wall], DT);
      stepMovement(b, cmd({ moveX: 1, moveZ: 1, yaw: i * 0.01, jump: i === 10 }), [floor, wall], DT);
    }
    expect(a.x).toBe(b.x); expect(a.y).toBe(b.y); expect(a.z).toBe(b.z);
  });

  it('applies gravity when airborne', () => {
    const p = newPlayerSimState(0, 10, 0);
    stepMovement(p, cmd(), [floor], DT);
    expect(p.vy).toBeCloseTo(-GRAVITY * DT, 3);
    expect(p.grounded).toBe(false);
  });
});
