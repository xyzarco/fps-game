
import { describe, it } from 'vitest';
import { BotBrain, NavService, GREYBOX, stepMovement, type AABB } from '../src/index.js';

describe('B6 benchmark AI', () => {
  it('16 bot @60Hz: ukur waktu AI per frame', async () => {
    const nav = new NavService();
    await nav.init();
    const brains: BotBrain[] = [];
    for (let i = 0; i < 16; i++) {
      const spawn = GREYBOX.spawns[i % GREYBOX.spawns.length] as [number, number, number];
      brains.push(new BotBrain(`bot_${i}`, spawn, 777 + i, nav, 'hard'));
    }
    let now = 1e6;
    const dt = 1 / 60;
    // warmup 5s
    for (let t = 0; t < 300; t++) {
      now += dt * 1000;
      const others = brains.map((b) => ({ id: b.state.id, x: b.state.sim.x, y: b.state.sim.y, z: b.state.sim.z, height: 1.8, dead: false, crouch: false }));
      for (const b of brains) stepMovement(b.state.sim, b.update({ others, sounds: [] }, now, dt, t), GREYBOX.boxes as AABB[], dt);
    }
    // ukur 30s sim
    const samples: number[] = [];
    for (let t = 0; t < 60 * 30; t++) {
      now += dt * 1000;
      const t0 = performance.now();
      const others = brains.map((b) => ({ id: b.state.id, x: b.state.sim.x, y: b.state.sim.y, z: b.state.sim.z, height: 1.8, dead: false, crouch: false }));
      const allies = new Set(brains.slice(0, 8).map((b) => b.state.id));
      for (const b of brains) {
        b.reportStatus(100, { pistol: 12 });
        stepMovement(b.state.sim, b.update({ others, sounds: [], allies }, now, dt, t), GREYBOX.boxes as AABB[], dt);
      }
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    const max = samples[samples.length - 1]!;
    console.log(JSON.stringify({ bots: 16, avgMs: +avg.toFixed(3), p95Ms: +p95.toFixed(3), maxMs: +max.toFixed(3) }));
  }, 180_000);
});
