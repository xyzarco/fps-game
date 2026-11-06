// Fase B3: persepsi & memori — kriteria BOTS.md 11/B3:
// - berdiri di balik tembok TIDAK terdeteksi (tanpa wallhack)
// - di luar FOV tidak terdeteksi
// - tembakan dekat memicu Investigate
// - memory decay setelah memorySec
import { describe, it, expect } from 'vitest';
import { GREYBOX, mulberry32, inFov, hasLos, Perception, DIFFICULTY, type PerceptTarget } from '../src/index.js';

const world = GREYBOX.boxes as any;
const now0 = 1_000_000;

function mkTarget(id: string, x: number, z: number): PerceptTarget {
  return { id, x, y: 0, z, height: 1.8, dead: false, crouch: false };
}

describe('Fase B3: persepsi', () => {
  it('FOV: target di depan terlihat, di belakang tidak', () => {
    // yaw 0 → forward (0,-1) (menghadap -Z)
    expect(inFov(0, 0, 0, 0, -10, 100)).toBe(true);
    expect(inFov(0, 0, 0, 0, 10, 100)).toBe(false); // belakang
    // yaw PI → forward (0,1)? dir=(-sin pi, -cos pi)=(0,1) → +Z
    expect(inFov(0, 0, Math.PI, 0, 10, 100)).toBe(true);
  });

  it('LOS: tembus tembok tidak terlihat', () => {
    // outer wall di z -40..-39; observer di (0,-35) menghadap dinding, target di (0,-45) — DI LUAR map (balik dinding)
    expect(hasLos(0, 1.6, -35, 0, 0, -45, 1.8, world)).toBe(false);
    // garis sejajar sisi terbuka → terlihat
    expect(hasLos(0, 1.6, -35, 30, 0, -35, 1.8, world)).toBe(true);
    // garis melalui central block (-6..6, 0..2, -6..6) → terhalang
    expect(hasLos(0, 1.6, -35, 0, 0, 30, 1.8, world)).toBe(false);
  });

  it('Perception.updateVision: tidak deteksi di balik tembok / di luar FOV; terlihat → memory + reaction', () => {
    const p = new Perception(DIFFICULTY.normal, mulberry32(1));
    // observer menghadap +X (yaw=-PI/2), target di belakangnya (-Z arah, x=0)
    p.updateVision(now0, { x: 0, y: 0, z: -20, yaw: -Math.PI / 2 }, [mkTarget('t1', 0, -40)], world);
    expect(p.visible.size).toBe(0);
    expect(p.memory.has('t1')).toBe(false);

    // target di depan (+X, arah -Z sisi terbuka) → visible + memory + reaction pending
    // (waktu maju > nextVisionCheck jitter)
    p.updateVision(now0 + 500, { x: 0, y: 0, z: -20, yaw: -Math.PI / 2 }, [mkTarget('t1', 20, -20)], world);
    expect(p.visible.has('t1')).toBe(true);
    expect(p.memory.has('t1')).toBe(true);
    expect(p.canReactTo('t1', now0)).toBe(false); // reaction time belum lewat
    expect(p.canReactTo('t1', now0 + 1000)).toBe(true);

    // hilang dari pandangan → visible kosong, memory masih ada (belum decay)
    p.updateVision(now0 + 1000, { x: 0, y: 0, z: -20, yaw: -Math.PI / 2 }, [mkTarget('t1', 0, -40)], world);
    expect(p.visible.size).toBe(0);
    expect(p.memory.has('t1')).toBe(true);
  });

  it('Memory decay setelah memorySec', () => {
    const p = new Perception(DIFFICULTY.easy, mulberry32(2)); // memory 4s
    p.updateVision(now0, { x: 0, y: 0, z: -20, yaw: -Math.PI / 2 }, [mkTarget('t1', 20, -20)], world);
    expect(p.memory.has('t1')).toBe(true);
    p.updateVision(now0 + 5000, { x: 0, y: 0, z: -20, yaw: -Math.PI / 2 }, [mkTarget('t1', 0, -40)], world);
    expect(p.memory.has('t1')).toBe(false); // decay 4s lewat
  });

  it('Hearing: suara dalam radius diterima (dgn noise), luar tidak', () => {
    const p = new Perception(DIFFICULTY.normal, mulberry32(3));
    p.hear([{ x: 10, y: 0, z: 0, radius: 30, t: now0 }], { x: 0, y: 0, z: 0 }, now0);
    expect(p.heardSounds.length).toBe(1);
    // diterima dengan noise: posisi tidak persis sama
    const heard = p.heardSounds[0]!;
    expect(heard.x).not.toBe(10);

    p.hear([{ x: 10, y: 0, z: 0, radius: 5, t: now0 }], { x: 0, y: 0, z: 0 }, now0);
    // heardSounds tetap 1 (radius 5 < jarak 10)
    expect(p.heardSounds.length).toBe(1);
  });
});
