// Authoritative GameRoom (Colyseus 0.18): fixed-timestep sim via shared sim, state sync via schema.
// Fase 3: authoritative hitscan + lag compensation, damage, death/respawn, kill feed, scoring.
import { Room, Client } from 'colyseus';
import { GameStateClass, GameState, PlayerClass, Player } from './GameState.js';
import {
  TICK_RATE, TICK_MS, SNAPSHOT_RATE, MAX_PLAYERS, MAX_HP, RESPAWN_DELAY_MS, SPAWN_PROTECT_MS,
  stepMovement, newPlayerSimState, GREYBOX, WEAPONS,
  fireWeapon,
  type InputCmd, type AABB, type WeaponId,
} from '@fps/shared';

interface PlayerEntity {
  player: Player;
  sim: ReturnType<typeof newPlayerSimState>;
  cmds: InputCmd[];
  hp: number;
  deadUntil: number;
  spawnProtectUntil: number;
  reloadUntil: number;
  ammo: number;
  reserve: number;
  weapon: WeaponId;
  lastFireAt: number;
  /** Position history for lag compensation: [serverTimeMs, x, y, z]. */
  history: { t: number; x: number; y: number; z: number; height: number }[];
}

const world: AABB[] = GREYBOX.boxes;
const MAX_REWIND_MS = 250;
const HISTORY_KEEP_MS = 1000;
/** InputCmd.fire handled only when server tick reaches fire time (rate limit). */
const MIN_INPUT_INTERVAL_MS = 5; // anti-flood: max ~200 cmds/s per client

export class GameRoom extends Room<any> {
  declare state: GameState;
  override maxClients = MAX_PLAYERS;
  entities = new Map<string, PlayerEntity>();

  override onCreate() {
    this.setState(new GameStateClass() as unknown as GameState);
    this.setPatchRate(1000 / SNAPSHOT_RATE);
    this.setSimulationInterval(() => this.step(), TICK_RATE);
    this.onMessage('input', (client: Client, data: { cmd: InputCmd }) => {
      const e = this.entities.get(client.sessionId);
      if (!e || typeof data?.cmd?.seq !== 'number') return;
      if (data.cmd.seq <= e.player.lastProcessedSeq) return; // duplicate/replay guard
      // anti-flood: rate limit cmd arrival per client
      const now = Date.now();
      if (e.cmds.length > 0) {
        const last = e.cmds[e.cmds.length - 1]! as InputCmd & { _recvAt?: number };
        const lastRecv = (last._recvAt ?? now - 100);
        if (now - lastRecv < MIN_INPUT_INTERVAL_MS) return;
        last._recvAt = now;
      }
      e.cmds.push(data.cmd);
      if (e.cmds.length > 120) e.cmds.splice(0, e.cmds.length - 120);
    });
    console.log('[GameRoom] created');
  }

  override onJoin(client: Client, options: { nickname?: string } = {}) {
    const nick = String(options?.nickname ?? 'Player').slice(0, 16).replace(/[<>]/g, '');
    const spawn = GREYBOX.spawns[this.entities.size % GREYBOX.spawns.length] as [number, number, number];
    const p = new PlayerClass() as Player;
    p.nickname = nick;
    p.x = spawn[0]; p.y = spawn[1]; p.z = spawn[2];
    this.state.players.set(client.sessionId, p);
    this.entities.set(client.sessionId, {
      player: p,
      sim: newPlayerSimState(spawn[0], spawn[1], spawn[2]),
      cmds: [], hp: MAX_HP, deadUntil: 0, spawnProtectUntil: Date.now() + SPAWN_PROTECT_MS,
      reloadUntil: 0, ammo: WEAPONS.pistol.magSize, reserve: -1, weapon: 'pistol',
      lastFireAt: 0, history: [],
    });
    client.send('welcome', { sessionId: client.sessionId });
    console.log(`[GameRoom] ${client.sessionId} (${nick}) joined`);
  }

  override onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.entities.delete(client.sessionId);
    console.log(`[GameRoom] ${client.sessionId} left`);
  }

  private step() {
    const dt = TICK_MS / 1000;
    const now = Date.now();
    this.state.serverTick++;
    this.state.serverTimeMs = now;

    // record position history for lag compensation
    for (const e of this.entities.values()) {
      e.history.push({ t: now, x: e.sim.x, y: e.sim.y, z: e.sim.z, height: e.sim.height });
      const cutoff = now - HISTORY_KEEP_MS;
      while (e.history.length > 2 && e.history[0]!.t < cutoff) e.history.shift();
    }

    // process respawn timers
    for (const e of this.entities.values()) {
      if (e.deadUntil > 0 && now >= e.deadUntil) this.respawn(e);
    }

    for (const e of this.entities.values()) {
      if (e.deadUntil > 0) continue;
      const cmd = e.cmds.shift();
      if (!cmd) continue;
      // authoritative sim (shared code with client prediction)
      stepMovement(e.sim, cmd, world, dt);
      e.player.lastProcessedSeq = cmd.seq;
      e.player.x = e.sim.x; e.player.y = e.sim.y; e.player.z = e.sim.z;
      e.player.yaw = Math.round(e.sim.yaw * 100);
      e.player.pitch = Math.round(e.sim.pitch * 100);
      e.player.crouch = e.sim.crouch;

      // weapon bookkeeping (authoritative timing)
      e.player.weapon = e.weapon;
      e.player.ammo = e.ammo;
      if (cmd.reload && e.ammo < WEAPONS[e.weapon].magSize && now >= e.reloadUntil) {
        e.reloadUntil = now + WEAPONS[e.weapon].reloadMs;
      }
      if (e.reloadUntil !== 0 && now >= e.reloadUntil && e.ammo < WEAPONS[e.weapon].magSize) {
        const need = WEAPONS[e.weapon].magSize - e.ammo;
        const take = e.reserve === -1 ? need : Math.min(need, e.reserve);
        e.ammo += take;
        if (e.reserve !== -1) e.reserve -= take;
        e.reloadUntil = 0;
      }
      // authoritative fire handling
      if (cmd.fire && e.ammo > 0 && now >= e.lastFireAt + WEAPONS[e.weapon].fireIntervalMs && e.reloadUntil === 0) {
        this.handleFire(e, cmd, now);
      }
    }
  }

  /** Server-side hitscan with lag compensation (rewind targets to shooter's view time). */
  private handleFire(shooter: PlayerEntity, cmd: InputCmd, now: number) {
    const w = WEAPONS[shooter.weapon];
    shooter.lastFireAt = now;
    shooter.ammo--;
    shooter.player.ammo = shooter.ammo;

    // view time = server now - one-way latency estimate - interp delay
    const shooterId = shooter.player === undefined ? '' : this.sessionIdOf(shooter);
    const shooterRttMs = shooter.cmds.length > 0 ? this.estimateRtt(shooter) : 0;
    const viewTime = now - Math.min(MAX_REWIND_MS, shooterRttMs / 2 + 100);

    // rewind targets to viewTime
    const targets: { x: number; y: number; z: number; height: number; id: string }[] = [];
    for (const [id, e] of this.entities) {
      if (id === shooterId || e.deadUntil > 0 || now < e.spawnProtectUntil) continue;
      const pos = this.rewind(e, viewTime) ?? e.sim;
      targets.push({ x: pos.x, y: pos.y, z: pos.z, height: pos.height, id });
    }

    const origin: [number, number, number] = [shooter.sim.x, shooter.sim.y + shooter.sim.height - 0.2, shooter.sim.z];
    const yaw = cmd.yaw, pitch = cmd.pitch;
    const dir: [number, number, number] = [
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    ];

    const results: { id: string; part: 'head' | 'body' | 'legs'; damage: number; point: [number, number, number] }[] = [];
    const targetBodies = targets.map((t) => ({ x: t.x, y: t.y, z: t.z, height: t.height }));
    let anyImpact: [number, number, number] | null = null;

    for (let pellet = 0; pellet < w.pellets; pellet++) {
      // spread (server applies weapon spread; shooter yaw/pitch are authoritative aim)
      const sp = pellet === 0 ? 0 : (Math.random() - 0.5) * 2 * w.spread;
      const spv = pellet === 0 ? 0 : (Math.random() - 0.5) * 2 * w.spread;
      const d: [number, number, number] = [dir[0] + spv, dir[1] + sp, dir[2]];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      d[0] /= l; d[1] /= l; d[2] /= l;

      const res = fireWeapon(origin, d, shooter.weapon, world, targetBodies, (p) => {
        const i = targetBodies.indexOf(p);
        const t = targets[i];
        return t ? Math.hypot(t.x - origin[0], t.z - origin[2]) : Infinity;
      });
      if (res.hitPlayer && res.hitPoint) {
        const i = targetBodies.findIndex((p, idx) =>
          Math.abs(p.x - res.hitPoint![0]) + Math.abs(p.z - res.hitPoint![2]) < 0.9,
        );
        if (i >= 0) results.push({ id: targets[i]!.id, part: res.hitPlayer.part, damage: res.damage, point: res.hitPoint });
      } else if (res.impactPoint) {
        anyImpact = res.impactPoint;
      }
    }

    // apply damage (aggregate pellets per target)
    const dmgById = new Map<string, { dmg: number; part: 'head' | 'body' | 'legs' }>();
    for (const r of results) {
      const prev = dmgById.get(r.id);
      dmgById.set(r.id, { dmg: (prev?.dmg ?? 0) + r.damage, part: r.part });
    }
    for (const [id, { dmg }] of dmgById) {
      const victim = this.entities.get(id);
      if (!victim || victim.deadUntil > 0 || now < victim.spawnProtectUntil) continue;
      victim.hp = Math.max(0, victim.hp - dmg);
      victim.player.hp = victim.hp;
      // notify shooter (hitmarker) and victim (damage) — server-confirmed only
      this.sessionOf(shooterId)?.send('hitConfirmed', { target: id, damage: dmg });
      this.sessionOf(id)?.send('damaged', { by: shooterId, amount: dmg });
      if (victim.hp === 0) this.kill(shooterId, id, shooter.weapon);
    }
    // broadcast tracer end for other clients (cosmetic) — keep minimal: only impact to shooter's own fx are client-side
    void anyImpact;
  }

  private kill(killerId: string, victimId: string, weapon: WeaponId) {
    const killer = this.state.players.get(killerId);
    const victim = this.state.players.get(victimId);
    const victimE = this.entities.get(victimId);
    if (!victim || !victimE) return;
    victimE.deadUntil = Date.now() + RESPAWN_DELAY_MS;
    victimE.player.dead = true;
    victimE.player.deaths++;
    if (killer && killerId !== victimId) killer.kills++;
    // kill feed broadcast
    this.broadcast('killFeed', {
      killer: killer?.nickname ?? victim.nickname,
      victim: victim.nickname,
      weapon,
      headshot: false,
      t: Date.now(),
    });
    console.log(`[GameRoom] kill: ${killer?.nickname ?? '?'} -> ${victim.nickname} (${weapon})`);
  }

  private respawn(e: PlayerEntity) {
    const spawn = GREYBOX.spawns[Math.floor(Math.random() * GREYBOX.spawns.length)] as [number, number, number];
    const s = newPlayerSimState(spawn[0], spawn[1], spawn[2]);
    e.sim = s;
    e.hp = MAX_HP;
    e.deadUntil = 0;
    e.spawnProtectUntil = Date.now() + SPAWN_PROTECT_MS;
    e.ammo = WEAPONS[e.weapon].magSize;
    e.player.hp = MAX_HP;
    e.player.dead = false;
    e.player.ammo = e.ammo;
    e.player.x = s.x; e.player.y = s.y; e.player.z = s.z;
  }

  private sessionIdOf(e: PlayerEntity): string {
    for (const [id, ent] of this.entities) if (ent === e) return id;
    return '';
  }

  private sessionOf(id: string): Client | undefined {
    return this.clients.find((c: Client) => c.sessionId === id);
  }

  /** Estimate RTT via lastProcessedSeq pacing — MVP: use input queue depth as rough proxy (20ms/cmd at 50Hz). */
  private estimateRtt(_e: PlayerEntity): number {
    // TODO: ping/pong measurement. For now assume 100ms+interp like blueprint default.
    return 200;
  }

  /** Rewind entity position to time t using history (lag compensation). */
  private rewind(e: PlayerEntity, t: number) {
    const h = e.history;
    if (h.length === 0) return null;
    if (t >= h[h.length - 1]!.t) return h[h.length - 1]!;
    for (let i = h.length - 1; i > 0; i--) {
      const b = h[i]!, a = h[i - 1]!;
      if (a.t <= t && t <= b.t) {
        const k = (t - a.t) / Math.max(1, b.t - a.t);
        return {
          t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k,
          z: a.z + (b.z - a.z) * k, height: a.height,
        };
      }
    }
    return h[0]!;
  }
}
