import { describe, it, expect } from 'vitest';
import { raycastBoxes } from './raycast.js';
import type { AABB } from './movement.js';

const box: AABB = { minX: 4, minY: -1, minZ: -1, maxX: 6, maxY: 1, maxZ: 1 };

describe('raycastBoxes', () => {
  it('hits the front face at expected distance', () => {
    const hit = raycastBoxes(0, 0, 0, 1, 0, 0, [box]);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(4, 5);
    expect(hit!.point[0]).toBeCloseTo(4, 5);
    expect(hit!.normal[0]).toBe(-1);
  });
  it('misses off-axis ray', () => {
    expect(raycastBoxes(0, 0, 3, 1, 0, 0, [box])).toBeNull();
  });
  it('respects maxT', () => {
    expect(raycastBoxes(0, 0, 0, 1, 0, 0, [box], 2)).toBeNull();
  });
  it('picks nearest of two boxes', () => {
    const far: AABB = { minX: 10, minY: -1, minZ: -1, maxX: 12, maxY: 1, maxZ: 1 };
    const hit = raycastBoxes(0, 0, 0, 1, 0, 0, [far, box]);
    expect(hit!.t).toBeCloseTo(4, 5);
  });
});
