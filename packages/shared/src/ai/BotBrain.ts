// BotBrain (BOTS.md 2.1): think(worldView, dt) → PlayerInput.
// Fase B2: state Roam — path following via navmesh, stuck detection, separation.
// PRNG ber-seed (ADR-008) agar perilaku reproducible.
import {
  newPlayerSimState,
  type InputCmd, type PlayerSimState,
} from '../index.js';
import { mulberry32, type Rng } from './rng.js';
import { NavService, type NavVec3 } from './navigation.js';

export interface BotWorldView {
  /** Posisi semua pemain lain (untuk separation & nanti persepsi B3). */
  others: { id: string; x: number; y: number; z: number }[];
}

export interface BotState {
  id: string;
  sim: PlayerSimState;
  path: NavVec3[];
  pathIdx: number;
  replanAt: number;
  goal: NavVec3 | null;
  /** Stuck detection (BOTS.md 3.4). */
  lastX: number; lastZ: number; stuckSince: number;
  strafeSign: number;
  /** Recovery mode: >0 = mundur/strafe dulu sebelum path lagi (BOTS.md 3.4). */
  recoverUntil: number;
  recoverMX: number;
  recoverMZ: number;
}

const REPLAN_INTERVAL_MS = 2500;
const WAYPOINT_REACH_DIST = 1.0;
const STUCK_DIST = 0.35;      // bergerak kurang dari ini dalam 1s = stuck
const STUCK_TIME_MS = 1000;
const SEPARATION_DIST = 1.6;

export class BotBrain {
  private nav: NavService;
  private rng: Rng;
  state: BotState;

  constructor(id: string, spawn: [number, number, number], seed: number, nav: NavService) {
    this.nav = nav;
    this.rng = mulberry32(seed);
    this.state = {
      id,
      sim: newPlayerSimState(spawn[0], spawn[1], spawn[2]),
      path: [], pathIdx: 0, replanAt: 0, goal: null,
      lastX: spawn[0], lastZ: spawn[2], stuckSince: 0,
      strafeSign: this.rng() < 0.5 ? 1 : -1,
      recoverUntil: 0, recoverMX: 0, recoverMZ: 0,
    };
  }

  /** Pilih goal roam baru (titik acak navmesh) & hitung path. */
  private replan(now: number) {
    const goal = this.nav.randomPoint();
    if (!goal) { this.state.replanAt = now + 500; return; }
    const from = this.nav.nearestPoint({ x: this.state.sim.x, y: this.state.sim.y, z: this.state.sim.z });
    if (!from) { this.state.replanAt = now + 500; return; }
    this.state.path = this.nav.findPath(from, goal);
    this.state.pathIdx = 0;
    this.state.goal = goal;
    this.state.replanAt = now + REPLAN_INTERVAL_MS + this.rng() * 200;
  }

  /**
   * Think: hasilkan PlayerInput (TANPA men-step sim — host yang men-step,
   * satu sumber kebenaran; BOTS.md 2.1 bot=input AI, sim host sama dgn pemain).
   */
  update(view: BotWorldView, now: number, dt: number, seq: number): InputCmd {
    const st = this.state;

    // goal/path: replan saat path habis, stuck, atau belum pernah plan
    if (st.pathIdx >= st.path.length || now >= st.replanAt) this.replan(now);

    // stuck detection
    const moved = Math.hypot(st.sim.x - st.lastX, st.sim.z - st.lastZ);
    if (moved < STUCK_DIST) {
      if (st.stuckSince === 0) st.stuckSince = now;
      else if (now - st.stuckSince > STUCK_TIME_MS) {
        // recovery (BOTS.md 3.4): mundur + strafe acak, lalu goal baru
        st.strafeSign = this.rng() < 0.5 ? 1 : -1;
        st.recoverUntil = now + 500 + this.rng() * 300;
        st.recoverMX = st.strafeSign;
        st.recoverMZ = -1; // mundur dari obstacle
        st.replanAt = 0;
        st.stuckSince = 0;
      }
    } else {
      st.stuckSince = 0;
      st.lastX = st.sim.x; st.lastZ = st.sim.z;
    }

    // arahkan ke waypoint
    let moveX = 0, moveZ = 0, yaw = st.sim.yaw;
    if (now < st.recoverUntil) {
      // recovery move: mundur/strafe, yaw tetap (jauhkan dari obstacle)
      return { seq, tick: 0, moveX: st.recoverMX, moveZ: st.recoverMZ, yaw: st.sim.yaw + Math.PI, pitch: 0, jump: false, crouch: false, walk: false, fire: false, reload: false, weaponSlot: null };
    }
    const wp = st.path[st.pathIdx];
    if (wp) {
      const dx = wp.x - st.sim.x, dz = wp.z - st.sim.z;
      const dist = Math.hypot(dx, dz);
      if (dist < WAYPOINT_REACH_DIST) {
        st.pathIdx++;
      } else {
        const targetYaw = Math.atan2(-dx, -dz); // dir=(-sin yaw, -cos yaw)
        // turn-speed clamp (ADR-010): 220 deg/s
        const maxTurn = (220 * Math.PI / 180) * dt;
        let dYaw = targetYaw - st.sim.yaw;
        while (dYaw > Math.PI) dYaw -= Math.PI * 2;
        while (dYaw < -Math.PI) dYaw += Math.PI * 2;
        yaw = st.sim.yaw + Math.max(-maxTurn, Math.min(maxTurn, dYaw));
        // gerak relatif yaw: maju
        moveZ = 1;
        // separation: dorongan menjauh dari bot terdekat
        let sepX = 0, sepZ = 0;
        for (const o of view.others) {
          if (o.id === st.id) continue;
          const ox = st.sim.x - o.x, oz = st.sim.z - o.z;
          const d = Math.hypot(ox, oz);
          if (d > 0.01 && d < SEPARATION_DIST) {
            sepX += (ox / d) * (1 - d / SEPARATION_DIST);
            sepZ += (oz / d) * (1 - d / SEPARATION_DIST);
          }
        }
        // konversi separation (world) ke lokal (rotasi -yaw)
        const s = Math.sin(-yaw), c = Math.cos(-yaw);
        const localSepX = sepX * c - sepZ * s;
        const localSepZ = sepX * s + sepZ * c;
        moveX = Math.max(-1, Math.min(1, localSepX * 2 + st.strafeSign * 0.25));
        moveZ = Math.max(-1, Math.min(1, moveZ + localSepZ));
      }
    }

    const cmd: InputCmd = {
      seq, tick: 0,
      moveX, moveZ,
      yaw, pitch: 0,
      jump: false, crouch: false, walk: false,
      fire: false, reload: false, weaponSlot: null,
    };
    return cmd;
  }
}
