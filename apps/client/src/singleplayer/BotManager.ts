// BotManager (BOTS.md 2.3): spawn bot; B2 = roam navmesh via BotBrain (shared).
// Input PlayerInput sama dengan pemain (diproses sim yang sama).
import { BotBrain, NavService, type NavVec3 } from '@fps/shared';
import { DIFFICULTY } from '@fps/shared';
import type { InputCmd, WeaponId } from '@fps/shared';
import type { LocalGameHost } from './LocalGameHost.js';
import type { LocalRoom } from './LocalGameHost.js';

const BOT_NAMES = [
  'Vex', 'Rook', 'Nova', 'Jinx', 'Onyx', 'Sable', 'Tango', 'Echo',
  'Frost', 'Havoc', 'Iris', 'Juno', 'Kilo', 'Lynx', 'Mirage', 'Drift',
];

interface BotEntry { id: string; name: string; team: number; brain: BotBrain; seq: number }

export class BotManager {
  bots = new Map<string, BotEntry>();
  private disposed = false;
  private nav: NavService | null = null;
  private navReady = false;

  constructor(
    private host: LocalGameHost,
    private room: LocalRoom,
    count: number,
    teamMode: 'ffa' | 'tdm' = 'ffa',
  ) {
    void this.initNav(count, teamMode);
  }

  /** Bake navmesh async; bot dulu dummy-wander sampai navmesh siap. */
  private async initNav(count: number, teamMode: 'ffa' | 'tdm') {
    this.nav = new NavService();
    await this.nav.init();
    if (this.disposed) return;
    for (let i = 0; i < count; i++) {
      const name = BOT_NAMES[i % BOT_NAMES.length]! + (i >= BOT_NAMES.length ? String(Math.floor(i / BOT_NAMES.length) + 1) : '');
      const team = teamMode === 'tdm' ? 1 : 0;
      const e = this.host.addEntity(`bot_${i}`, name, true, team);
      const brain = new BotBrain(e.id, [e.sim.x, e.sim.y, e.sim.z], 1000 + i * 7919, this.nav);
      this.bots.set(e.id, { id: e.id, name, team, brain, seq: 0 });
    }
    this.navReady = true;
  }

  /** Dipanggil tiap tick oleh LocalGameHost.step — generate input untuk tiap bot. */
  tick(now: number, dt: number) {
    if (this.disposed || !this.navReady) return;
    const others = [...this.bots.values()].map((b) => ({ id: b.id, x: b.brain.state.sim.x, y: b.brain.state.sim.y, z: b.brain.state.sim.z }));
    for (const b of this.bots.values()) {
      const e = this.host.entity(b.id);
      if (!e) continue;
      if (e.deadUntil > 0) { b.seq++; continue; }
      // sync: brain selalu mengikuti sim entity (host = satu-satunya sim; BOTS.md 2.1)
      const br = b.brain.state;
      br.sim.x = e.sim.x; br.sim.y = e.sim.y; br.sim.z = e.sim.z;
      br.sim.yaw = e.sim.yaw; br.sim.pitch = e.sim.pitch;
      br.sim.vx = e.sim.vx; br.sim.vz = e.sim.vz;
      br.sim.height = e.sim.height; br.sim.crouch = e.sim.crouch;
      b.brain.reportStatus(e.hp, { pistol: e.ammo });
      const cmd = b.brain.update({ others, sounds: BotBrain.soundBus.drain(now) }, now, dt, ++b.seq);
      e.cmds.push(cmd);
      if (e.cmds.length > 60) e.cmds.splice(0, e.cmds.length - 60);
    }
  }

  dispose() {
    this.disposed = true;
    for (const id of this.bots.keys()) this.host.removeEntity(id);
    this.bots.clear();
  }
}
