
import { describe, it, expect } from 'vitest';
import { BotBrain, NavService, GREYBOX, stepMovement, type AABB, type InputCmd } from '../src/index.js';

describe('Fase B4: headless bot vs bot combat', () => {
  it('8 bot duel 30s: ada kill, tanpa NaN, tidak keluar map', async () => {
    const nav = new NavService();
    await nav.init();
    const brains: BotBrain[] = [];
    for (let i = 0; i < 8; i++) {
      const spawn = GREYBOX.spawns[i % GREYBOX.spawns.length] as [number, number, number];
      brains.push(new BotBrain(`bot_${i}`, spawn, 5000 + i * 131, nav, i < 4 ? 'hard' : 'easy'));
    }
    const hp = new Map<string, number>(brains.map((b) => [b.state.id, 100]));
    const deadUntil = new Map<string, number>();
    let now = 1e6;
    const dt = 1 / 60;
    let kills = 0;
    let nan = 0;
    for (let t = 0; t < 60 * 30; t++) {
      now += dt * 1000;
      const others = brains.map((b) => ({
        id: b.state.id, x: b.state.sim.x, y: b.state.sim.y, z: b.state.sim.z,
        height: 1.8, dead: (deadUntil.get(b.state.id) ?? 0) > now, crouch: false,
      }));
      const freshKills: string[] = [];
      for (const b of brains) {
        const id = b.state.id;
        if ((deadUntil.get(id) ?? 0) > now) continue;
        b.reportStatus(hp.get(id)!, { pistol: 12 });
        const cmd = b.update({ others, sounds: [] }, now, dt, t);
        stepMovement(b.state.sim, cmd, GREYBOX.boxes as AABB[], dt);
        const s = b.state.sim;
        if (!Number.isFinite(s.x + s.y + s.z)) nan++;
        if (Math.abs(s.x) > 40 || Math.abs(s.z) > 40) throw new Error('out of bounds');
        // hitscan sederhana antar bot (jarak < 30, saling hadap kasar, fire)
        if (cmd.fire) {
          for (const o of brains) {
            if (o.state.id === id || (deadUntil.get(o.state.id) ?? 0) > now) continue;
            const d = Math.hypot(o.state.sim.x - s.x, o.state.sim.z - s.z);
            if (d < 30) {
              const hpv = (hp.get(o.state.id) ?? 100) - 20;
              hp.set(o.state.id, hpv);
              if (hpv <= 0 && (deadUntil.get(o.state.id) ?? 0) <= now) {
                deadUntil.set(o.state.id, now + 3000);
                freshKills.push(o.state.id);
                kills++;
              }
            }
          }
        }
      }
      // respawn
      for (const b of brains) {
        const id = b.state.id;
        if ((deadUntil.get(id) ?? 0) !== 0 && (deadUntil.get(id) ?? 0) <= now) {
          deadUntil.set(id, 0);
          hp.set(id, 100);
          const sp = GREYBOX.spawns[Math.floor(Math.random() * GREYBOX.spawns.length)] as [number, number, number];
          b.state.sim = { ...b.state.sim, x: sp[0], y: sp[1], z: sp[2], vx: 0, vz: 0, vy: 0 };
        }
      }
    }
    expect(nan).toBe(0);
    expect(kills).toBeGreaterThan(3); // duel hidup
    expect(kills).toBeLessThan(200);  // bukan aimbot membantai
  }, 120_000);
});
