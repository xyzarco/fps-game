// BotManager (BOTS.md 2.3, Fase B1): spawn bot dummy — berdiri/berjalan acak,
// input PlayerInput sama dengan pemain (diproses sim yang sama). AI penuh di B2+.
import type { InputCmd, WeaponId } from '@fps/shared';
import type { LocalGameHost } from './LocalGameHost.js';
import type { LocalRoom } from './LocalGameHost.js';

const BOT_NAMES = [
  'Vex', 'Rook', 'Nova', 'Jinx', 'Onyx', 'Sable', 'Tango', 'Echo',
  'Frost', 'Havoc', 'Iris', 'Juno', 'Kilo', 'Lynx', 'Mirage', 'Drift',
];

export class BotManager {
  bots = new Map<string, { id: string; name: string; team: number; state: 'idle' | 'wander'; nextMoveAt: number; moveX: number; moveZ: number; jump: boolean; seq: number; yaw: number }>();
  private disposed = false;

  constructor(
    private host: LocalGameHost,
    private room: LocalRoom,
    count: number,
    teamMode: 'ffa' | 'tdm' = 'ffa',
  ) {
    for (let i = 0; i < count; i++) {
      const name = BOT_NAMES[i % BOT_NAMES.length]! + (i >= BOT_NAMES.length ? String(Math.floor(i / BOT_NAMES.length) + 1) : '');
      const team = teamMode === 'tdm' ? 1 : 0; // B1: bot jadi tim B saat TDM (pemain tim A)
      const e = this.host.addEntity(`bot_${i}`, name, true, team);
      // posisi entity sudah diset addEntity (spawn rotation)
      this.bots.set(e.id, {
        id: e.id, name, team, state: 'idle',
        nextMoveAt: Date.now() + 1000 + Math.random() * 2000,
        moveX: 0, moveZ: 0, jump: false, seq: 0, yaw: Math.random() * Math.PI * 2,
      });
    }
  }

  /** Dipanggil tiap tick oleh LocalGameHost.step — generate input untuk tiap bot. */
  tick(now: number, _dt: number) {
    if (this.disposed) return;
    for (const b of this.bots.values()) {
      const e = this.host.entity(b.id);
      if (!e) continue;
      // ganti arah gerak acak tiap interval (dummy wander — B2 diganti navmesh)
      if (now >= b.nextMoveAt) {
        b.state = b.state === 'idle' ? 'wander' : 'idle';
        b.nextMoveAt = now + 1200 + Math.random() * 2200;
        if (b.state === 'wander') {
          const ang = Math.random() * Math.PI * 2;
          b.moveX = Math.sin(ang);
          b.moveZ = -Math.cos(ang);
          b.yaw = ang;
          b.jump = Math.random() < 0.1;
        } else {
          b.moveX = 0; b.moveZ = 0; b.jump = false;
        }
      }
      if (e.deadUntil > 0) { b.seq++; continue; }

      const cmd: InputCmd = {
        seq: ++b.seq,
        tick: 0,
        moveX: b.moveX,
        moveZ: b.moveZ,
        yaw: b.yaw,
        pitch: 0,
        jump: b.jump,
        crouch: false,
        walk: false,
        fire: false, // B1 dummy: tidak menembak (combat mulai B4)
        reload: false,
        weaponSlot: null,
      };
      // feed langsung ke entity antrean (host memproses di step sama)
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
