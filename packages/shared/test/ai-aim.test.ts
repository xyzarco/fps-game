// Fase B4: aim model manusiawi — konvergensi, turn-speed clamp, fire tolerance,
// pemilihan senjata (BOTS.md 10 unit tests).
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/ai/rng.js';
import { newAimState, resampleAimError, turnToward, withinFireTolerance, pickWeapon } from '../src/index.js';
import { DIFFICULTY } from '../src/index.js';

describe('Fase B4: aim model', () => {
  it('turn clamp: tidak melebihi turnSpeed per tick', () => {
    // normal: 220 deg/s, dt 1/60 → max 3.67 deg/tick
    const maxTurn = (220 * Math.PI / 180) / 60;
    const r = turnToward(0, 0, Math.PI / 2, 0, maxTurn);
    expect(Math.abs(r.yaw)).toBeCloseTo(maxTurn, 5);
    // konvergensi: cukup tick sampai target
    let yaw = 0;
    for (let i = 0; i < 120; i++) yaw = turnToward(yaw, 0, Math.PI / 2, 0, maxTurn).yaw;
    expect(Math.abs(yaw - Math.PI / 2)).toBeLessThan(0.01);
  });

  it('aim error: mengecil saat tracking lama (decay)', () => {
    const rng = mulberry32(7);
    const a1 = newAimState(0);
    resampleAimError(a1, 0, DIFFICULTY.normal, 10, rng); // tracking 0s
    const a2 = newAimState(0);
    resampleAimError(a2, 2000, DIFFICULTY.normal, 10, rng); // tracking 2s
    // sampling acak — bandingkan sigma via banyak sample
    let sum1 = 0, sum2 = 0;
    for (let i = 0; i < 500; i++) {
      const b1 = newAimState(0); resampleAimError(b1, 0, DIFFICULTY.normal, 10, rng); sum1 += Math.abs(b1.errYaw);
      const b2 = newAimState(0); resampleAimError(b2, 2000, DIFFICULTY.normal, 10, rng); sum2 += Math.abs(b2.errYaw);
    }
    expect(sum2).toBeLessThan(sum1); // tracking lebih lama → error lebih kecil
  });

  it('aim error: bertambah dengan jarak', () => {
    const rng = mulberry32(9);
    let near = 0, far = 0;
    for (let i = 0; i < 500; i++) {
      const a = newAimState(0); resampleAimError(a, 0, DIFFICULTY.normal, 5, rng); near += Math.abs(a.errYaw);
      const b = newAimState(0); resampleAimError(b, 0, DIFFICULTY.normal, 50, rng); far += Math.abs(b.errYaw);
    }
    expect(far).toBeGreaterThan(near);
  });

  it('fire tolerance gate', () => {
    expect(withinFireTolerance(0.01, 0, 3)).toBe(true);
    expect(withinFireTolerance(0.2, 0, 3)).toBe(false); // 0.2 rad = 11.5 deg
  });

  it('pemilihan senjata by jarak & ammo', () => {
    const has = () => true;
    expect(pickWeapon(8, { shotgun: 5, rifle: 30 }, has)).toBe('shotgun');
    expect(pickWeapon(40, { shotgun: 5, sniper: 10 }, has)).toBe('sniper');
    expect(pickWeapon(20, { rifle: 30 }, has)).toBe('rifle');
    expect(pickWeapon(20, {}, has)).toBe('pistol'); // fallback pistol
    expect(pickWeapon(20, { pistol: 0 }, (w) => w !== 'pistol')).toBe(null);
  });
});
