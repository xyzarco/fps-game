// Authoritative game room: fixed-timestep sim at TICK_RATE, snapshots at SNAPSHOT_RATE.
import { TICK_MS, SNAPSHOT_RATE, MAX_PLAYERS, TICK_RATE } from '@fps/shared';
import type { InputCmd, Snapshot, PlayerState } from '@fps/shared';

export class GameRoom {
  onMessageToClient: (id: string, data: string) => void = () => {};
  private players = new Map<string, { ps: PlayerState; cmds: InputCmd[] }>();
  private tick = 0;
  private lastSeq = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  join(id: string) {
    if (this.players.size >= MAX_PLAYERS) return;
    this.players.set(id, {
      ps: {
        id, nickname: `Player ${id}`, team: 0,
        x: (this.players.size % 4) * 3 - 4, y: 1, z: 0, vy: 0,
        yaw: 0, pitch: 0, crouch: false, hp: 100,
        weapon: 'pistol', ammo: 12, dead: false,
        spawnProtectUntil: 0, lastProcessedSeq: 0,
      },
      cmds: [],
    });
    console.log(`[room] ${id} joined (${this.players.size} players)`);
    if (!this.timer) this.timer = setInterval(() => this.step(), TICK_MS);
  }

  leave(id: string) { this.players.delete(id); this.lastSeq.delete(id); }

  onClientMessage(id: string, msg: unknown) {
    const p = this.players.get(id);
    if (!p) return;
    if (typeof msg === 'object' && msg !== null && (msg as { type?: string }).type === 'input') {
      const cmd = (msg as { cmd: InputCmd }).cmd;
      // basic rate limit: drop wildly out-of-order seq
      if (typeof cmd?.seq === 'number' && cmd.seq > (this.lastSeq.get(id) ?? 0)) {
        this.lastSeq.set(id, cmd.seq);
        p.cmds.push(cmd);
        if (p.cmds.length > 60) p.cmds.shift();
      }
    }
  }

  private step() {
    this.tick++;
    const dt = TICK_MS / 1000;
    for (const p of this.players.values()) {
      const cmd = p.cmds.shift();
      if (!cmd) continue;
      p.ps.lastProcessedSeq = cmd.seq;
      // TODO (Fase 1-3): apply shared sim movement + combat here
      p.ps.yaw = cmd.yaw; p.ps.pitch = cmd.pitch;
    }
    if (this.tick % (TICK_RATE / SNAPSHOT_RATE) === 0) this.broadcastSnapshot();
  }

  private broadcastSnapshot() {
    const snap: Snapshot = {
      serverTick: this.tick,
      serverTimeMs: Date.now(),
      players: [...this.players.values()].map((p) => p.ps),
      events: [],
    };
    const data = JSON.stringify({ type: 'snapshot', snap });
    for (const id of this.players.keys()) this.onMessageToClient(id, data);
  }
}
