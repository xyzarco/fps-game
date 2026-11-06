// Authoritative GameRoom (Colyseus 0.18): fixed-timestep sim via shared sim, state sync via schema.
// Fase 3: authoritative hitscan + lag compensation, damage, death/respawn, kill feed, scoring.
// Fase 4: match flow (warmup→live→ended), FFA/TDM, chat, match restart.
import { Room, Client } from 'colyseus';
import { GameStateClass, GameState, PlayerClass, Player } from './GameState.js';
import {
  TICK_RATE, TICK_MS, SNAPSHOT_RATE, MAX_PLAYERS, MAX_HP, RESPAWN_DELAY_MS, SPAWN_PROTECT_MS,
  WARMUP_MS, MATCH_TIME_MS, KILL_LIMIT, SCOREBOARD_PAUSE_MS,
  stepMovement, newPlayerSimState, GREYBOX, WEAPONS,
  fireWeapon,
  type InputCmd, type AABB, type WeaponId,
} from '@fps/shared';
import { metrics, log } from '../metrics.js';

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
  /** Position history for lag compensation. */
  history: { t: number; x: number; y: number; z: number; height: number }[];
  /** RTT diukur via ping/pong (Fase 6) — dipakai lag compensation. */
  rttMs: number;
}

const world: AABB[] = GREYBOX.boxes;
const MAX_REWIND_MS = 250;
const HISTORY_KEEP_MS = 1000;
const MIN_INPUT_INTERVAL_MS = 5; // anti-flood: max ~200 cmds/s per client

const sanitizeNick = (raw: unknown) =>
  String(raw ?? 'Player').trim().slice(0, 16).replace(/[<>&"']/g, '') || 'Player';

export class GameRoom extends Room<any> {
  declare state: GameState;
  override maxClients = MAX_PLAYERS;
  entities = new Map<string, PlayerEntity>();
  private delayedRef: { clear: () => void } | null = null;

  override onCreate(options: { mode?: string } = {}) {
    this.setState(new GameStateClass() as unknown as GameState);
    this.state.mode = options.mode === 'tdm' ? 'tdm' : 'ffa';
    this.setPatchRate(1000 / SNAPSHOT_RATE);
    this.setSimulationInterval(() => this.step(), TICK_RATE);
    this.startWarmup();
    this.onMessage('input', (client: Client, data: { cmd: InputCmd }) => {
      const e = this.entities.get(client.sessionId);
      if (!e || typeof data?.cmd?.seq !== 'number') return;
      if (data.cmd.seq <= e.player.lastProcessedSeq) return; // duplicate/replay guard
      // anti-flood: batasi ukuran antrean (bukan membuang cmd di tengah — memutus determinisme prediksi)
      e.cmds.push(data.cmd);
      if (e.cmds.length > 240) e.cmds.splice(0, e.cmds.length - 240);
    });
    // Fase 4: chat (sanitized)
    this.onMessage('chat', (client: Client, data: { text: string }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || typeof data?.text !== 'string') return;
      const text = data.text.slice(0, 120).replace(/[<>]/g, '').trim();
      if (!text) return;
      this.broadcast('chat', { from: p.nickname, text, t: Date.now() });
    });
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'room_create', roomId: this.roomId, mode: this.state.mode }));
  }

  override onJoin(client: Client, options: { nickname?: string } = {}) {
    const nick = sanitizeNick(options?.nickname);
    const spawn = GREYBOX.spawns[this.entities.size % GREYBOX.spawns.length] as [number, number, number];
    const p = new PlayerClass() as Player;
    p.nickname = nick;
    p.team = this.state.mode === 'tdm' ? this.pickTeam() : 0;
    p.x = spawn[0]; p.y = spawn[1]; p.z = spawn[2];
    this.state.players.set(client.sessionId, p);
    this.entities.set(client.sessionId, {
      player: p,
      sim: newPlayerSimState(spawn[0], spawn[1], spawn[2]),
      cmds: [], hp: MAX_HP, deadUntil: 0, spawnProtectUntil: Date.now() + SPAWN_PROTECT_MS,
      reloadUntil: 0, ammo: WEAPONS.pistol.magSize, reserve: -1, weapon: 'pistol',
      lastFireAt: 0, history: [], rttMs: 200,
    });
    client.send('welcome', { sessionId: client.sessionId });
    this.broadcast('chat', { from: 'system', text: `${nick} joined`, t: Date.now() });
    log('info', 'room_join', { roomId: this.roomId, sessionId: client.sessionId, nick, team: p.team, players: this.entities.size });
    // ping loop: ukur RTT tiap 2 dtk (dipakai lag comp)
    this.clock.setInterval(() => {
      const t0 = Date.now();
      client.send('ping', { t: t0 });
    }, 2000);
    this.onMessage('pong', (c: Client, data: { t: number }) => {
      const ent = this.entities.get(c.sessionId);
      if (ent) ent.rttMs = Math.max(1, Date.now() - data.t);
    });
  }

  override onLeave(client: Client) {
    const p = this.state.players.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.entities.delete(client.sessionId);
    if (p) this.broadcast('chat', { from: 'system', text: `${p.nickname} left`, t: Date.now() });
    log('info', 'room_leave', { roomId: this.roomId, sessionId: client.sessionId, nick: p?.nickname, players: this.entities.size });
  }

  // ---------- match flow ----------

  private startWarmup() {
    this.state.phase = 'warmup';
    this.state.phaseEndsAt = Date.now() + WARMUP_MS;
    this.clock.setTimeout(() => this.startMatch(), WARMUP_MS);
  }

  private startMatch() {
    if (this.state.phase === 'live') return;
    this.state.teamScoreA = 0; this.state.teamScoreB = 0;
    for (const p of this.state.players.values()) { p.kills = 0; p.deaths = 0; }
    for (const e of this.entities.values()) {
      e.hp = MAX_HP; e.deadUntil = 0; e.player.dead = false; e.player.hp = MAX_HP;
      this.respawn(e);
    }
    this.state.phase = 'live';
    this.state.matchEndsAt = Date.now() + MATCH_TIME_MS;
    this.broadcast('matchStart', { endsAt: this.state.matchEndsAt, mode: this.state.mode });
    console.log('[GameRoom] match live');
  }

  private endMatch() {
    if (this.state.phase !== 'live') return;
    this.state.phase = 'ended';
    this.state.phaseEndsAt = Date.now() + SCOREBOARD_PAUSE_MS;
    const scores = [...this.state.players.values()]
      .map((p) => ({ name: p.nickname, kills: p.kills, deaths: p.deaths, team: p.team }))
      .sort((a, b) => b.kills - a.kills);
    const winner = this.state.mode === 'tdm'
      ? (this.state.teamScoreA >= this.state.teamScoreB ? 'Team A' : 'Team B')
      : (scores[0]?.name ?? '-');
    this.broadcast('matchEnd', { winner, scores, teamA: this.state.teamScoreA, teamB: this.state.teamScoreB, t: Date.now() });
    console.log(`[GameRoom] match ended, winner=${winner}`);
    this.delayedRef = this.clock.setTimeout(() => { this.startWarmup(); this.startMatch(); }, SCOREBOARD_PAUSE_MS);
  }

  private pickTeam(): number {
    let a = 0, b = 0;
    for (const p of this.state.players.values()) p.team === 0 ? a++ : b++;
    return a <= b ? 0 : 1;
  }

  private checkMatchEnd() {
    if (this.state.phase !== 'live') return;
    const timeUp = Date.now() >= this.state.matchEndsAt;
    let limitHit = false;
    if (this.state.mode === 'tdm') {
      limitHit = this.state.teamScoreA >= KILL_LIMIT || this.state.teamScoreB >= KILL_LIMIT;
    } else {
      for (const p of this.state.players.values()) if (p.kills >= KILL_LIMIT) limitHit = true;
    }
    if (timeUp || limitHit) this.endMatch();
  }

  // ---------- simulation ----------

  private step() {
    const t0 = performance.now();
    const dt = TICK_MS / 1000;
    const now = Date.now();
    this.state.serverTick++;
    this.state.serverTimeMs = now;

    this.checkMatchEnd();
    if (this.state.phase === 'ended') {
      for (const e of this.entities.values()) e.cmds.length = 0; // freeze during scoreboard
      return;
    }

    // record position history for lag compensation
    for (const e of this.entities.values()) {
      e.history.push({ t: now, x: e.sim.x, y: e.sim.y, z: e.sim.z, height: e.sim.height });
      const cutoff = now - HISTORY_KEEP_MS;
      while (e.history.length > 2 && e.history[0]!.t < cutoff) e.history.shift();
    }

    for (const e of this.entities.values()) {
      if (e.deadUntil > 0 && now >= e.deadUntil) this.respawn(e);
    }

    for (const e of this.entities.values()) {
      if (e.deadUntil > 0) continue;
      const cmd = e.cmds.shift();
      if (!cmd) continue;
      stepMovement(e.sim, cmd, world, dt);
      e.player.lastProcessedSeq = cmd.seq;
      e.player.x = e.sim.x; e.player.y = e.sim.y; e.player.z = e.sim.z;
      e.player.yaw = Math.round(e.sim.yaw * 100);
      e.player.pitch = Math.round(e.sim.pitch * 100);
      e.player.crouch = e.sim.crouch;

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
      if (cmd.fire && e.ammo > 0 && now >= e.lastFireAt + WEAPONS[e.weapon].fireIntervalMs && e.reloadUntil === 0) {
        this.handleFire(e, cmd, now);
      }
    }
    metrics.recordTick(performance.now() - t0);
  }

  /** Server-side hitscan with lag compensation (rewind targets to shooter's view time). */
  private handleFire(shooter: PlayerEntity, cmd: InputCmd, now: number) {
    const w = WEAPONS[shooter.weapon];
    shooter.lastFireAt = now;
    shooter.ammo--;
    shooter.player.ammo = shooter.ammo;

    const shooterId = this.sessionIdOf(shooter);
    const shooterRttMs = shooter.rttMs;
    const viewTime = now - Math.min(MAX_REWIND_MS, shooterRttMs / 2 + 100);

    const targets: { x: number; y: number; z: number; height: number; id: string }[] = [];
    for (const [id, e] of this.entities) {
      if (id === shooterId || e.deadUntil > 0 || now < e.spawnProtectUntil) continue;
      if (this.state.mode === 'tdm' && e.player.team === shooter.player.team) continue; // no friendly fire
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

    const results: { id: string; damage: number; point: [number, number, number] }[] = [];
    const targetBodies = targets.map((t) => ({ x: t.x, y: t.y, z: t.z, height: t.height }));

    for (let pellet = 0; pellet < w.pellets; pellet++) {
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
        const i = targetBodies.findIndex((p) =>
          Math.abs(p.x - res.hitPoint![0]) + Math.abs(p.z - res.hitPoint![2]) < 0.9,
        );
        if (i >= 0) results.push({ id: targets[i]!.id, damage: res.damage, point: res.hitPoint });
      }
    }

    const dmgById = new Map<string, number>();
    for (const r of results) dmgById.set(r.id, (dmgById.get(r.id) ?? 0) + r.damage);
    for (const [id, dmg] of dmgById) {
      const victim = this.entities.get(id);
      if (!victim || victim.deadUntil > 0 || now < victim.spawnProtectUntil) continue;
      victim.hp = Math.max(0, victim.hp - dmg);
      victim.player.hp = victim.hp;
      this.sessionOf(shooterId)?.send('hitConfirmed', { target: id, damage: dmg });
      this.sessionOf(id)?.send('damaged', { by: shooterId, amount: dmg });
      if (victim.hp === 0) this.kill(shooterId, id, shooter.weapon);
    }
  }

  private kill(killerId: string, victimId: string, weapon: WeaponId) {
    const killer = this.state.players.get(killerId);
    const victim = this.state.players.get(victimId);
    const victimE = this.entities.get(victimId);
    if (!victim || !victimE) return;
    victimE.deadUntil = Date.now() + RESPAWN_DELAY_MS;
    victimE.player.dead = true;
    victimE.player.deaths++;
    if (killer && killerId !== victimId) {
      killer.kills++;
      if (this.state.mode === 'tdm') {
        if (killer.team === 0) this.state.teamScoreA++;
        else this.state.teamScoreB++;
      }
    }
    this.broadcast('killFeed', {
      killer: killer?.nickname ?? victim.nickname,
      victim: victim.nickname,
      weapon,
      headshot: false,
      t: Date.now(),
    });
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'room_kill', roomId: this.roomId, killer: killer?.nickname ?? '?', victim: victim.nickname, weapon }));
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
