// Persepsi bot (BOTS.md Bagian 4, Fase B3): vision (FOV + LOS), hearing, memory.
// Bot HANYA bereaksi pada yang terlihat/terdengar — tidak ada wallhack (BOTS.md #4).
import { raycastBoxes, GREYBOX, type AABB } from '../index.js';
import type { Rng } from './rng.js';

export interface PerceptTarget {
  id: string;
  x: number; y: number; z: number; // feet
  height: number;
  dead: boolean;
  crouch: boolean;
}

export interface SoundEvent {
  x: number; y: number; z: number;
  radius: number;        // world radius (tembakan besar, langkah kecil)
  t: number;
}

export interface DifficultyParams {
  fovDeg: number;            // 90/100/110/120
  hearMul: number;           // 0.7/1.0/1.2/1.4
  memorySec: number;         // 4/7/10/14
  reactionSec: number;       // 0.8/0.45/0.25/0.12 (dipakai combat B4)
  turnSpeedDeg: number;
  aimErrorDeg: number;
  aggressiveness: number;
}

export const DIFFICULTY: Record<'easy' | 'normal' | 'hard' | 'insane', DifficultyParams> = {
  easy:   { fovDeg: 90,  hearMul: 0.7, memorySec: 4,  reactionSec: 0.8,  turnSpeedDeg: 120, aimErrorDeg: 6,   aggressiveness: 0.3 },
  normal: { fovDeg: 100, hearMul: 1.0, memorySec: 7,  reactionSec: 0.45, turnSpeedDeg: 220, aimErrorDeg: 3.5, aggressiveness: 0.5 },
  hard:   { fovDeg: 110, hearMul: 1.2, memorySec: 10, reactionSec: 0.25, turnSpeedDeg: 360, aimErrorDeg: 1.8, aggressiveness: 0.7 },
  insane: { fovDeg: 120, hearMul: 1.4, memorySec: 14, reactionSec: 0.12, turnSpeedDeg: 540, aimErrorDeg: 0.8, aggressiveness: 0.9 },
};

export interface MemoryEntry {
  targetId: string;
  lastKnown: { x: number; y: number; z: number };
  lastSeenT: number;
  /** Perkiraan arah gerak saat terakhir terlihat (BOTS.md 4.3). */
  lastVel: { x: number; z: number };
}

/** Cek FOV: target dalam kerucut pandang? (yaw-only; pitch diabaikan — FPS ground). */
export function inFov(eyeX: number, eyeZ: number, yaw: number, targetX: number, targetZ: number, fovDeg: number): boolean {
  const dx = targetX - eyeX, dz = targetZ - eyeZ;
  const d = Math.hypot(dx, dz);
  if (d < 0.001) return true;
  // forward dir = (-sin yaw, -cos yaw)
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const dot = (dx / d) * fx + (dz / d) * fz;
  return dot >= Math.cos((fovDeg / 2) * Math.PI / 180);
}

/** LOS: ray dari mata ke titik tubuh target; true bila tidak terhalang dunia. */
export function hasLos(
  eyeX: number, eyeY: number, eyeZ: number,
  tx: number, ty: number, tz: number, tHeight: number,
  world: AABB[],
): boolean {
  // raycast ke 3 titik tubuh: kepala, dada, kaki (BOTS.md 4.1) — cukup 1 lolos
  const bodyY = [tHeight - 0.15, tHeight * 0.55, tHeight * 0.1];
  for (const py of bodyY) {
    const dx = tx - eyeX, dy = py - eyeY, dz = tz - eyeZ;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.01) return true;
    const l = 1 / dist;
    const hit = raycastBoxes(eyeX, eyeY, eyeZ, dx * l, dy * l, dz * l, world, dist - 0.05);
    if (!hit) return true;
  }
  return false;
}

export class Perception {
  readonly memory = new Map<string, MemoryEntry>();
  /** Target yang saat ini terlihat (LOS + FOV + alive). */
  visible = new Set<string>();
  /** Waktu reaksi: earliest time boleh ACT on target (BOTS.md 4.1). */
  private reactAt = new Map<string, number>();
  private nextVisionCheck = 0;
  /** Event suara yang diterima (diinvestigasi). */
  heardSounds: SoundEvent[] = [];

  constructor(private diff: DifficultyParams, private rng: Rng) {}

  /**
   * Vision check — dipanggil ~8Hz per bot (di-stagger oleh pemanggil).
   * Mengisi visible set & memory.
   */
  updateVision(
    now: number,
    eye: { x: number; y: number; z: number; yaw: number },
    targets: PerceptTarget[],
    world: AABB[],
  ) {
    if (now < this.nextVisionCheck) return;
    this.nextVisionCheck = now + 100 + this.rng() * 40; // ~8-10Hz + jitter
    const seen = new Set<string>();
    for (const t of targets) {
      if (t.dead) { this.visible.delete(t.id); continue; }
      const dist = Math.hypot(t.x - eye.x, t.z - eye.z);
      if (dist > 55) continue; // jarak maksimum persepsi
      if (!inFov(eye.x, eye.z, eye.yaw, t.x, t.z, this.diff.fovDeg)) continue;
      const eyeY = eye.y + 1.6;
      if (!hasLos(eye.x, eyeY, eye.z, t.x, t.y, t.z, t.crouch ? 1.2 : t.height, world)) continue;
      seen.add(t.id);
      const prev = this.memory.get(t.id);
      const lastVel = prev
        ? prev.lastVel
        : { x: 0, z: 0 };
      this.memory.set(t.id, {
        targetId: t.id,
        lastKnown: { x: t.x, y: t.y, z: t.z },
        lastSeenT: now,
        lastVel,
      });
      // reaction time: mulai berlalu saat pertama terlihat setelah gap
      if (!this.visible.has(t.id) && !this.reactAt.has(t.id)) {
        const jitter = (this.rng() - 0.5) * 0.15 * this.diff.reactionSec;
        this.reactAt.set(t.id, now + this.diff.reactionSec * 1000 * (1 + jitter / this.diff.reactionSec));
      }
    }
    this.visible = seen;
    // memory decay (BOTS.md 4.3)
    const cutoff = now - this.diff.memorySec * 1000;
    for (const [id, m] of this.memory) {
      if (m.lastSeenT < cutoff) {
        this.memory.delete(id);
        this.reactAt.delete(id);
      }
    }
  }

  /** Terima suara dalam radius (dikali faktor kesulitan) — BOTS.md 4.2. */
  hear(sounds: SoundEvent[], listener: { x: number; y: number; z: number }, now: number) {
    for (const s of sounds) {
      const d = Math.hypot(s.x - listener.x, s.y - listener.y, s.z - listener.z);
      const radius = s.radius * this.diff.hearMul;
      if (d <= radius && now - s.t < 200) {
        // posisi dengan noise (BOTS.md 4.2)
        const noise = d * 0.15 * (this.rng() - 0.5);
        this.heardSounds.push({
          x: s.x + noise, y: s.y, z: s.z + noise,
          radius: s.radius, t: s.t,
        });
      }
    }
    if (this.heardSounds.length > 5) this.heardSounds.splice(0, this.heardSounds.length - 5);
  }

  /** Boleh bertindak pada target (reaction time lewat)? */
  canReactTo(targetId: string, now: number): boolean {
    const t = this.reactAt.get(targetId);
    return t === undefined ? false : now >= t;
  }

  /** Target prioritas: memori terbaru (BOTS.md 5.2 sederhana). */
  mostRecentMemory(now: number): MemoryEntry | null {
    let best: MemoryEntry | null = null;
    for (const m of this.memory.values()) {
      if (!best || m.lastSeenT > best.lastSeenT) best = m;
    }
    return best;
  }

  /** Sumber suara terbaru yang belum kadaluarsa (Investigate). */
  latestSound(now: number): SoundEvent | null {
    const fresh = this.heardSounds.filter((s) => now - s.t < 4000);
    if (fresh.length === 0) return null;
    return fresh[fresh.length - 1]!;
  }
}

/** Emit suara dari simulasi (BOTS.md 4.2) — dipanggil host saat fire/step/jump. */
export class SoundBus {
  private events: SoundEvent[] = [];
  emit(x: number, y: number, z: number, radius: number, now: number) {
    this.events.push({ x, y, z, radius, t: now });
    if (this.events.length > 64) this.events.splice(0, this.events.length - 64);
  }
  /** Panggil per tick untuk dapat event fresh; events dibersihkan otomatis (>200ms). */
  drain(now: number): SoundEvent[] {
    this.events = this.events.filter((e) => now - e.t < 200);
    return this.events;
  }
}
