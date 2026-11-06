import { describe, it, expect } from 'vitest';
import { fireWeapon, raycastPlayer } from './combat.js';
import type { AABB } from './movement.js';

const floor: AABB = { minX: -40, minY: -1, minZ: -40, maxX: 40, maxY: 0, maxZ: 40 };

describe('combat', () => {
  const shooter: [number, number, number] = [0, 1.6, 0];
  it('hits a standing player body', () => {
    const target = { x: 10, y: 0, z: 0, height: 1.8 };
    const r = fireWeapon(shooter, [1, 0, 0], 'pistol', [floor], [target], () => 10);
    expect(r.hitPlayer?.part).toBe('body');
    expect(r.damage).toBe(20);
    expect(r.hitPoint![0]).toBeGreaterThan(9);
  });
  it('headshot multiplies damage', () => {
    const target = { x: 10, y: 0, z: 0, height: 1.8 };
    const r = fireWeapon(shooter, [1, 0.02, 0], 'pistol', [floor], [target], () => 10);
    expect(r.hitPlayer?.part).toBe('head');
    expect(r.damage).toBe(40);
  });
  it('wall closer than player blocks the shot', () => {
    const target = { x: 10, y: 0, z: 0, height: 1.8 };
    const wall: AABB = { minX: 5, minY: 0, minZ: -2, maxX: 6, maxY: 3, maxZ: 2 };
    const r = fireWeapon(shooter, [1, 0, 0], 'pistol', [floor, wall], [target], () => 10);
    expect(r.hitPlayer).toBeNull();
    expect(r.impactPoint![0]).toBeCloseTo(5, 3);
  });
  it('shotgun falloff reduces damage at range', () => {
    const near = { x: 5, y: 0, z: 0, height: 1.8 };
    const far = { x: 20, y: 0, z: 0, height: 1.8 };
    const rNear = fireWeapon(shooter, [1, 0, 0], 'shotgun', [floor], [near], () => 5);
    const rFar = fireWeapon(shooter, [1, 0, 0], 'shotgun', [floor], [far], () => 20);
    expect(rNear.damage).toBeGreaterThan(rFar.damage);
  });
  it('raycastPlayer zones legs/body/head', () => {
    const t = { x: 5, y: 0, z: 0, height: 1.8 };
    const head = raycastPlayer(0, 1.6, 0, 1, 0.033, 0, t);
    const legs = raycastPlayer(0, 1.0, 0, 1, -0.15, 0, t);
    expect(head?.part).toBe('head');
    expect(legs?.part).toBe('legs');
  });
});
