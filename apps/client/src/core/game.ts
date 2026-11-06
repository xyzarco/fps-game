// Multiplayer core: local prediction + reconciliation, remote interpolation, camera, weapons, HUD.
import * as THREE from 'three';
import { TICK_MS, PLAYER_HEIGHT, INTERP_DELAY_MS, MAX_HP, stepMovement, newPlayerSimState, fireWeapon, GREYBOX, WEAPONS, type WeaponId, type InputCmd } from '@fps/shared';
import { InputManager } from './input.js';
import { NetClient, type RemoteSnapshot } from '../net/netclient.js';
import type { GameHost } from '../net/host.js';
import { LocalGameHost } from '../singleplayer/LocalGameHost.js';
import { audio } from '../audio/audiomanager.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const SENSITIVITY = 0.0022;
const MAX_PENDING = 120;

interface RemoteVisual { mesh: THREE.Mesh; nameplate: THREE.Sprite; name: string; lastPos?: [number, number] }

export class Game {
  input: InputManager;
  /** Host aktif: jaringan (NetClient) atau lokal (LocalGameHost, mode vs bots). */
  net: GameHost = new NetClient();
  private localHost: LocalGameHost | null = null;
  sim = newPlayerSimState(0, 0, -30);       // predicted local state
  pending: InputCmd[] = [];                 // inputs not yet acked
  connected = false;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sceneCamera: THREE.PerspectiveCamera;
  private dummies: { sim: ReturnType<typeof newPlayerSimState>; hp: number; mesh: THREE.Mesh; nameplate: THREE.Sprite }[] = [];
  private remotes = new Map<string, RemoteVisual>();
  private acc = 0;
  private lastTime = 0;
  private seq = 0;
  private serverEstOffset = 0;
  private weapon: WeaponId = 'pistol';
  private ammo = WEAPONS.pistol.magSize;
  private reserve = WEAPONS.pistol.reserveAmmo;
  private nextFireAt = 0;
  private reloadUntil = 0;
  private muzzleFlash: THREE.PointLight;
  private tracers: { line: THREE.Line; until: number }[] = [];
  private viewmodel: THREE.Group;
  private hud = { hp: el('hud-hp'), ammo: el('hud-ammo'), weapon: el('hud-weapon'), hitmarker: el('hitmarker'), lock: el('lock-hint'), fps: el('fps'), ping: el('hud-ping') };
  private fpsFrames = 0;
  private fpsLast = performance.now();
  private lastSnapshot: RemoteSnapshot | null = null;
  private deathUntil = 0;
  private deathTimer: ReturnType<typeof setInterval> | null = null;
  private scoreboard = { el: el('scoreboard'), body: el('sb-body') as HTMLElement, visible: false };
  private vignette = el('damage-vignette') as HTMLElement;
  private killfeedEl = el('killfeed') as HTMLElement;
  private deathOverlay = el('death-overlay') as HTMLElement;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    this.scene.background = new THREE.Color(0x2a3550);
    this.scene.fog = new THREE.Fog(0x2a3550, 40, 95);
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 300);
    this.sceneCamera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 10);
    // lighting untuk viewmodel scene (GLB pakai MeshStandardMaterial)
    this.sceneCamera.add(new THREE.HemisphereLight(0xaebcff, 0x2b2f3a, 1.4));
    const vmKey = new THREE.DirectionalLight(0xfff2d9, 2.2);
    vmKey.position.set(0.5, 1, 0.8);
    this.sceneCamera.add(vmKey);

    const hemi = new THREE.HemisphereLight(0xaebcff, 0x2b2f3a, 1.2);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.7);
    sun.position.set(20, 40, 10);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x6ea8ff, 0.5);
    rim.position.set(-25, 18, -20);
    this.scene.add(rim);

    this.buildMap();
    this.buildDummies(4);
    this.viewmodel = this.buildViewmodel();
    this.sceneCamera.add(this.viewmodel);
    this.muzzleFlash = new THREE.PointLight(0xffcc66, 0, 6);
    this.viewmodel.add(this.muzzleFlash);
    this.muzzleFlash.position.set(0.25, -0.18, -0.6);

    this.input = new InputManager(canvas);
    this.input.onLockChange = (l) => {
      this.hud.lock.style.display = l ? 'none' : 'flex';
      if (l) { audio.unlock(); void this.loadAssets(); } // autoplay policy: gesture
    };
    // quality preset dari settings
    const preset = localStorage.getItem('fps.quality') ?? 'high';
    this.renderer.setPixelRatio(preset === 'low' ? 1 : Math.min(devicePixelRatio, preset === 'medium' ? 1.25 : 2));

    window.addEventListener('resize', () => {
      this.camera.aspect = this.sceneCamera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix(); this.sceneCamera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    this.net.onJoinWorld = () => {
      this.connected = true;
      this.registerServerMessages();
      this.registerScoreboard();
    };
  }

  async connect(nickname: string, opts: { mode?: string; roomCode?: string } = {}) {
    await this.net.join(nickname.slice(0, 16) || 'Player', opts);
  }

  /** Fase B1: main vs bot tanpa server — LocalGameHost menjalankan sim yang sama. */
  async connectLocal(nickname: string, opts: { mode?: string; botCount?: number } = {}) {
    this.localHost?.dispose();
    const host = new LocalGameHost();
    host.onJoinWorld = () => { this.connected = true; this.registerServerMessages(); this.registerScoreboard(); };
    this.net = host;
    this.localHost = host;
    this.connected = false;
    await host.join(nickname.slice(0, 16) || 'Player', opts);
  }

  /** Server-confirmed events: hitmarker, damage, kill feed, death/respawn. */
  private registerServerMessages() {
    this.net.room!.onMessage('hitConfirmed', (data: { target: string; damage: number }) => {
      this.showHitmarker(data.damage);
    });
    this.net.room!.onMessage('damaged', (data: { by: string; amount: number }) => {
      this.vignette.style.opacity = '1';
      setTimeout(() => (this.vignette.style.opacity = '0'), 250);
      audio.play('hurt', 0.8);
    });
    this.net.room!.onMessage('killFeed', (data: { killer: string; victim: string; weapon: string }) => {
      this.addKillFeed(data.killer, data.victim, data.weapon);
      // if I'm the victim → death overlay until respawn
      const me = this.net.latest?.players.get(this.net.sessionId!);
      if (me && data.victim === me.nickname) this.showDeath();
    });
    this.net.room!.onMessage('ping', (data: { t: number }) => {
      this.net.room!.send('pong', data); // echo → server ukur RTT
    });
    this.net.room!.onMessage('chat', (data: { from: string; text: string }) => {
      this.addChatLine(data.from, data.text);
    });
    this.net.room!.onMessage('matchStart', (data: { endsAt: number; mode: string }) => {
      this.matchEndsAt = data.endsAt;
      this.hideMatchOverlay();
      this.addChatLine('system', 'Match dimulai! Good luck 🎯');
    });
    this.net.room!.onMessage('matchEnd', (data: { winner: string; scores: { name: string; kills: number; deaths: number }[] }) => {
      this.showMatchOverlay(data);
    });
    this.registerChatInput();
  }

  private matchEndsAt = 0;

  private registerChatInput() {
    const input = document.getElementById('chat-text') as HTMLInputElement;
    const wrap = document.getElementById('chat-input') as HTMLElement;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && !this.chatOpen) {
        this.chatOpen = true;
        wrap.style.display = 'block';
        setTimeout(() => input.focus(), 0);
      } else if (e.key === 'Escape' && this.chatOpen) {
        this.closeChat(input, wrap);
      } else if (e.key === 'Enter' && this.chatOpen) {
        const text = input.value.trim();
        if (text) this.net.room?.send('chat', { text });
        input.value = '';
        this.closeChat(input, wrap);
      }
    });
  }

  private chatOpen = false;

  private closeChat(input: HTMLInputElement, wrap: HTMLElement) {
    this.chatOpen = false;
    input.value = '';
    wrap.style.display = 'none';
    input.blur();
  }

  private addChatLine(from: string, text: string) {
    const log = document.getElementById('chat-log') as HTMLElement;
    const div = document.createElement('div');
    div.innerHTML = from === 'system'
      ? `<i>${escapeHtml(text)}</i>`
      : `<b>${escapeHtml(from)}:</b> ${escapeHtml(text)}`;
    log.appendChild(div);
    while (log.children.length > 6) log.firstChild?.remove();
    setTimeout(() => div.remove(), 12000);
  }

  private showMatchOverlay(data: { winner: string; scores: { name: string; kills: number; deaths: number }[] }) {
    const overlay = document.getElementById('match-overlay') as HTMLElement;
    const detail = document.getElementById('match-detail') as HTMLElement;
    detail.textContent = `🏆 ${data.winner}\n` + data.scores.slice(0, 5).map((s, i) => `${i + 1}. ${s.name} — ${s.kills} kill / ${s.deaths} death`).join('\n');
    overlay.style.display = 'flex';
    setTimeout(() => (overlay.style.display = 'none'), 8000);
  }

  private hideMatchOverlay() {
    (document.getElementById('match-overlay') as HTMLElement).style.display = 'none';
  }

  private showDeath() {
    this.deathOverlay.style.display = 'flex';
    if (this.deathTimer) clearInterval(this.deathTimer);
    const small = document.getElementById('death-timer')!;
    let left = 3;
    small.textContent = 'Respawn dalam 3…';
    this.deathTimer = setInterval(() => {
      left--;
      if (left <= 0) {
        clearInterval(this.deathTimer!);
        this.deathOverlay.style.display = 'none';
      } else {
        small.textContent = `Respawn dalam ${left}…`;
      }
    }, 1000);
  }

  private addKillFeed(killer: string, victim: string, weapon: string) {
    const div = document.createElement('div');
    div.innerHTML = `<b>${escapeHtml(killer)}</b> ⚔ ${escapeHtml(weapon)} → <i>${escapeHtml(victim)}</i>`;
    this.killfeedEl.appendChild(div);
    while (this.killfeedEl.children.length > 5) this.killfeedEl.firstChild?.remove();
    setTimeout(() => div.remove(), 5000);
  }

  private registerScoreboard() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.scoreboard.visible = true;
        this.scoreboard.el.style.display = 'block';
        return;
      }
      // weapon switch 1–4
      const slotIdx = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (slotIdx >= 0) {
        const id: WeaponId = (['pistol', 'rifle', 'shotgun', 'sniper'] as WeaponId[])[slotIdx]!;
        this.switchWeapon(id);
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') {
        this.scoreboard.visible = false;
        this.scoreboard.el.style.display = 'none';
      }
    });
  }

  private switchWeapon(id: WeaponId) {
    if (id === this.weapon || this.reloadUntil !== 0) return;
    this.weapon = id;
    audio.play('switch', 0.6);
    this.ammo = WEAPONS[id].magSize;
    this.reserve = WEAPONS[id].reserveAmmo;
    this.nextFireAt = performance.now() + 400; // switch delay
  }

  private updateScoreboard() {
    if (!this.scoreboard.visible || !this.net.latest) return;
    const rows = [...this.net.latest.players.entries()]
      .map(([id, p]) => ({ id, name: p.nickname, hp: p.hp, dead: p.dead }))
      // kills/deaths read from authoritative schema state directly
      .map((r) => {
        const sp = this.net.room!.state.players.get(r.id) as { kills?: number; deaths?: number; nickname?: string } | undefined;
        return { ...r, kills: sp?.kills ?? 0, deaths: sp?.deaths ?? 0 };
      })
      .sort((a, b) => b.kills - a.kills);
    this.scoreboard.body.innerHTML = rows
      .map((r) => `<tr${r.id === this.net.sessionId ? ' class="me"' : ''}><td>${escapeHtml(r.name)}${r.dead ? ' 💀' : ''}</td><td>${r.kills}</td><td>${r.deaths}</td></tr>`)
      .join('');
  }

  private buildMap() {
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x5a627a });
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x3c4258 });
    for (const b of GREYBOX.boxes) {
      const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), h < 6 ? wallMat : floorMat);
      mesh.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      this.scene.add(mesh);
    }
  }

  private buildDummies(n: number) {
    const spots = [[-12, 0, 12], [12, 0, 12], [-12, 0, -12], [12, 0, -14]];
    const geo = new THREE.CapsuleGeometry(0.4, PLAYER_HEIGHT - 0.8, 6, 12);
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xd95f4e }));
      const [x, y, z] = spots[i % spots.length] as [number, number, number];
      mesh.position.set(x, y + PLAYER_HEIGHT / 2, z);
      this.scene.add(mesh);
      this.dummies.push({ sim: newPlayerSimState(x, y, z), hp: 100, mesh, nameplate: makeNameplate(`Dummy ${i + 1}`) });
      const np = this.dummies[this.dummies.length - 1]!.nameplate;
      np.position.set(x, y + PLAYER_HEIGHT + 0.35, z);
      this.scene.add(np);
    }
  }

  private buildViewmodel(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.42), new THREE.MeshLambertMaterial({ color: 0x2b2f3d }));
    body.position.set(0.25, -0.2, -0.5);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.18), new THREE.MeshLambertMaterial({ color: 0x171a24 }));
    barrel.position.set(0.25, -0.17, -0.78);
    g.add(body, barrel);
    // Fase 5: real GLB viewmodel (Kenney, MIT) — Draco-compressed; progres → loading screen
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    loader.setDRACOLoader(draco);
    loader.load('/assets/models/blaster.glb', (gltf) => {
      const m = gltf.scene;
      m.scale.setScalar(0.55);
      m.position.set(0.22, -0.28, -0.55);
      m.rotation.y = Math.PI; // muzzle forward
      g.add(m);
      this.viewmodelGlb = m;
    }, undefined, () => {/* fallback: keep box viewmodel */});
    return g;
  }

  private viewmodelGlb: THREE.Group | null = null;

  /** Load SFX buffers (called once after first user gesture). */
  private async loadAssets() {
    if (this.assetsLoaded) return;
    this.assetsLoaded = true;
    try {
      await Promise.all([
        audio.load('shot', '/assets/audio/blaster.ogg'),
        audio.load('shot2', '/assets/audio/blaster_repeater.ogg'),
        audio.load('jump', '/assets/audio/jump_a.ogg'),
        audio.load('land', '/assets/audio/land.ogg'),
        audio.load('step', '/assets/audio/walking.ogg'),
        audio.load('switch', '/assets/audio/weapon_change.ogg'),
        audio.load('hurt', '/assets/audio/enemy_hurt.ogg'),
      ]);
    } catch { /* non-fatal */ }
  }

  /** Load SFX + model dengan progress → loading screen (dipanggil saat connect). */
  async preload(onProgress?: (p: number, label: string) => void) {
    const steps = 8; let done = 0;
    const step = (label: string) => { done++; onProgress?.(done / steps, label); };
    const sfx: [string, string][] = [
      ['shot', 'blaster.ogg'], ['shot2', 'blaster_repeater.ogg'], ['jump', 'jump_a.ogg'],
      ['land', 'land.ogg'], ['step', 'walking.ogg'], ['switch', 'weapon_change.ogg'], ['hurt', 'enemy_hurt.ogg'],
    ];
    audio.unlock();
    for (const [name, file] of sfx) {
      await audio.load(name, `/assets/audio/${file}`);
      step(`audio: ${file}`);
    }
    await new Promise<void>((resolve) => {
      const loader = new GLTFLoader();
      const draco = new DRACOLoader();
      draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
      loader.setDRACOLoader(draco);
      loader.load('/assets/models/blaster.glb', () => { step('model: blaster.glb'); resolve(); }, undefined, () => { step('model: fallback'); resolve(); });
    });
  }

  private assetsLoaded = false;
  private stepAccum = 0;

  start() {
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame() {
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.25) dt = 0.25;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK_MS / 1000 && steps < 5) {
      this.tick(TICK_MS / 1000, now);
      this.acc -= TICK_MS / 1000;
      steps++;
    }
    this.renderFrame(now);
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.sceneCamera, this.sceneCamera);
    this.renderer.autoClear = true;
    this.muzzleFlash.intensity = Math.max(0, this.muzzleFlash.intensity - 40 * dt);
    this.fpsFrames++;
    if (now - this.fpsLast >= 500) {
      this.hud.fps.textContent = `${Math.round((this.fpsFrames * 1000) / (now - this.fpsLast))} fps`;
      this.fpsLast = now; this.fpsFrames = 0;
    }
  }

  private tick(dt: number, now: number) {
    this.seq++;
    const [mdx, mdy] = this.input.consumeMouse(SENSITIVITY);
    this.sim.yaw -= mdx;
    this.sim.pitch = clamp(this.sim.pitch - mdy, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);

    const cmd: InputCmd = {
      seq: this.seq, tick: this.seq, moveX: this.input.moveX, moveZ: this.input.moveZ,
      yaw: this.sim.yaw, pitch: this.sim.pitch, jump: this.input.jump,
      crouch: this.input.crouch, walk: this.input.walk,
      fire: WEAPONS[this.weapon].auto ? this.input.fireDown : this.input.consumeFirePressed(),
      reload: this.input.keys.has('KeyR'), weaponSlot: null,
    };

    // client-side prediction: apply immediately
    const wasGrounded = this.sim.grounded;
    stepMovement(this.sim, cmd, GREYBOX.boxes, dt);
    if (!wasGrounded && this.sim.grounded) audio.play('land', 0.5, 1 + Math.random() * 0.1);
    else if (wasGrounded && !this.sim.grounded && cmd.jump) audio.play('jump', 0.45);
    // footsteps sederhana: tiap ~0.4s saat bergerak di tanah
    if (this.sim.grounded && (cmd.moveX !== 0 || cmd.moveZ !== 0)) {
      this.stepAccum += dt;
      if (this.stepAccum > 0.4) { this.stepAccum = 0; audio.play('step', 0.22, 0.9 + Math.random() * 0.2); }
    } else this.stepAccum = 0;
    this.pending.push(cmd);
    if (this.pending.length > MAX_PENDING) this.pending.shift();

    if (this.connected) this.net.sendInput(cmd);

    // reconciliation: rewind to acked server state, replay unacked inputs
    if (this.connected) {
      const acked = this.net.lastProcessedSeq;
      if (acked > 0 && this.pending.length && this.pending[0]!.seq <= acked) {
        const serverPlayer = this.net.sessionId ? this.net.latest?.players.get(this.net.sessionId) : undefined;
        if (serverPlayer) {
          this.sim.x = serverPlayer.x; this.sim.y = serverPlayer.y; this.sim.z = serverPlayer.z;
          for (const c of this.pending) {
            if (c.seq > acked) stepMovement(this.sim, c, GREYBOX.boxes, TICK_MS / 1000);
          }
          this.pending = this.pending.filter((c) => c.seq > acked);
        }
      }
      if (this.net.latest) {
        const off = this.net.latest.serverTimeMs - now;
        this.serverEstOffset = this.serverEstOffset === 0 ? off : this.serverEstOffset * 0.95 + off * 0.05;
      }
    }

    // weapon
    if (cmd.reload && this.ammo < WEAPONS[this.weapon].magSize && now >= this.reloadUntil) {
      this.reloadUntil = now + WEAPONS[this.weapon].reloadMs;
    }
    if (this.reloadUntil !== 0 && now >= this.reloadUntil && this.ammo < WEAPONS[this.weapon].magSize) {
      const need = WEAPONS[this.weapon].magSize - this.ammo;
      const take = this.reserve === -1 ? need : Math.min(need, this.reserve);
      this.ammo += take;
      if (this.reserve !== -1) this.reserve -= take;
      this.reloadUntil = 0;
    }
    if (cmd.fire && now >= this.nextFireAt && this.ammo > 0 && this.reloadUntil === 0) {
      this.nextFireAt = now + WEAPONS[this.weapon].fireIntervalMs;
      this.ammo--;
      this.fireShot();
    }

    this.camera.position.set(this.sim.x, this.sim.y + this.sim.height - 0.2, this.sim.z);
    this.camera.rotation.set(this.sim.pitch, this.sim.yaw, 0, 'YXZ');
  }

  private renderFrame(now: number) {
    if (this.net.latest) {
      const renderTime = now + this.serverEstOffset - INTERP_DELAY_MS;
      const snap = this.net.interpolate(renderTime);
      if (snap) this.applyRemoteSnapshot(snap);
    }
    for (const d of this.dummies) {
      d.mesh.visible = d.hp > 0;
      d.mesh.rotation.y = Math.sin(now / 1500 + d.sim.x) * 0.5;
    }
    this.viewmodel.position.y = Math.sin(now / 400) * 0.004;
    this.viewmodel.position.x = Math.cos(now / 500) * 0.003;
    this.updateHud();
    this.updateTracers(now);
  }

  private applyRemoteSnapshot(snap: RemoteSnapshot) {
    this.lastSnapshot = snap;
    const seen = new Set<string>();
    for (const [id, p] of snap.players) {
      if (id === this.net.sessionId) continue;
      seen.add(id);
      let rv = this.remotes.get(id);
      if (!rv) {
        const mesh = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.4, PLAYER_HEIGHT - 0.8, 6, 12),
          new THREE.MeshLambertMaterial({ color: 0x4ea3d9 }),
        );
        this.scene.add(mesh);
        const nameplate = makeNameplate(p.nickname || 'Player');
        this.scene.add(nameplate);
        rv = { mesh, nameplate, name: p.nickname };
        this.remotes.set(id, rv);
      }
      rv.mesh.position.set(p.x, p.y + PLAYER_HEIGHT / 2, p.z);
      rv.mesh.visible = !p.dead;
      rv.nameplate.position.set(p.x, p.y + PLAYER_HEIGHT + 0.35, p.z);
      rv.nameplate.visible = !p.dead;
      // footstep posisional pemain lain: dengar saat mereka dekat & bergerak
      if (rv.lastPos && !p.dead) {
        const moved = Math.hypot(p.x - rv.lastPos[0], p.z - rv.lastPos[1]);
        if (moved > 0.35 && moved < 2 && rv.lastPos) {
          const cam = this.camera.position;
          audio.playAt('step', p.x - cam.x, (p.y ?? 0) - cam.y, p.z - cam.z, 8);
        }
      }
      rv.lastPos = [p.x, p.z];
    }
    for (const [id, rv] of this.remotes) {
      if (!seen.has(id)) {
        this.scene.remove(rv.mesh, rv.nameplate);
        this.remotes.delete(id);
      }
    }
  }

  private fireShot() {
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.sim.pitch, this.sim.yaw, 0, 'YXZ'));
    const origin: [number, number, number] = [this.sim.x, this.sim.y + this.sim.height - 0.2, this.sim.z];
    const aliveDummies = this.dummies.filter((d) => d.hp > 0);
    const targets = aliveDummies.map((d) => ({ x: d.sim.x, y: d.sim.y, z: d.sim.z, height: d.sim.height }));
    const remoteTargets: { x: number; y: number; z: number; height: number; id: string }[] = [];
    if (this.lastSnapshot) {
      for (const [id, p] of this.lastSnapshot.players) {
        if (id === this.net.sessionId || p.dead) continue;
        remoteTargets.push({ x: p.x, y: p.y, z: p.z, height: PLAYER_HEIGHT, id });
      }
    }
    const allTargets = [...targets, ...remoteTargets.map((r) => ({ x: r.x, y: r.y, z: r.z, height: r.height }))];
    const res = fireWeapon(origin, [dir.x, dir.y, dir.z], this.weapon, GREYBOX.boxes, allTargets, (p) => {
      const i = allTargets.indexOf(p);
      const t = i >= 0 ? allTargets[i] : undefined;
      return t ? Math.hypot(t.x - origin[0], t.z - origin[2]) : Infinity;
    });
    this.muzzleFlash.intensity = 8;
    audio.play(this.weapon === 'rifle' ? 'shot2' : 'shot', 0.9, 0.95 + Math.random() * 0.1);
    this.addTracer(origin, res.hitPoint ?? res.impactPoint ?? [dir.x * 100, dir.y * 100, dir.z * 100]);
    // Hitmarker & damage hanya dari konfirmasi server (hitConfirmed) — PLAN.md 4.4
    if (res.hitPlayer) {
      this.showHitmarker(0); // pending marker tanpa angka; angka muncul saat server konfirmasi
    }
  }

  private addTracer(a: ArrayLike<number>, b: ArrayLike<number>) {
    // Fase 5: object pooling — tracer & spark di-reuse, tanpa alloc/dispose per tembakan
    let line = this.tracerPool.pop();
    if (!line) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0.8 }));
      this.scene.add(line);
    }
    const pos = line.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, a[0]!, a[1]!, a[2]!);
    pos.setXYZ(1, b[0]!, b[1]!, b[2]!);
    pos.needsUpdate = true;
    line.visible = true;
    this.tracers.push({ line, until: performance.now() + 80 });
    // VFX: impact spark kecil di titik kena
    let spark = this.sparkPool.pop();
    if (!spark) {
      spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.9 }),
      );
      this.scene.add(spark);
    }
    spark.position.set(b[0]!, b[1]!, b[2]!);
    spark.visible = true;
    this.tracers.push({ line: spark as unknown as THREE.Line, until: performance.now() + 120 });
  }

  private tracerPool: THREE.Line[] = [];
  private sparkPool: THREE.Mesh[] = [];

  private updateTracers(now: number) {
    this.tracers = this.tracers.filter((t) => {
      if (now > t.until) {
        t.line.visible = false;
        const obj = t.line as unknown as THREE.Mesh;
        if (obj.isMesh) this.sparkPool.push(obj);
        else this.tracerPool.push(t.line);
        return false;
      }
      return true;
    });
  }

  private showHitmarker(dmg: number) {
    const el = this.hud.hitmarker;
    el.textContent = dmg > 0 ? `✛ ${dmg}` : '✛';
    el.style.opacity = '1';
    setTimeout(() => (el.style.opacity = '0'), 120);
  }

  private updateHud() {
    const me = this.net.sessionId ? (this.net.latest?.players.get(this.net.sessionId)?.hp ?? MAX_HP) : MAX_HP;
    this.hud.hp.textContent = `HP ${me}`;
    this.hud.hp.classList.toggle('low', me <= 30);
    this.hud.ammo.textContent = this.reloadUntil !== 0 ? 'RELOADING…' : `${this.ammo} / ${this.reserve === -1 ? '∞' : this.reserve}`;
    this.hud.weapon.textContent = WEAPONS[this.weapon].name;
    this.hud.ping.textContent = this.connected ? `connected · ${this.remotes.size} remote` : 'offline (sandbox)';
    // match phase HUD (from authoritative state)
    const st = this.net.room?.state as { phase?: string; matchEndsAt?: number; mode?: string; teamScoreA?: number; teamScoreB?: number } | undefined;
    if (st?.phase) {
      const matchEl = document.getElementById('hud-match')!;
      if (st.phase === 'warmup') {
        matchEl.textContent = 'WARMUP — match segera dimulai…';
      } else if (st.phase === 'live') {
        const left = Math.max(0, Math.ceil(((st.matchEndsAt ?? 0) - (this.net.latest?.serverTimeMs ?? Date.now())) / 1000));
        const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, '0');
        matchEl.textContent = st.mode === 'tdm'
          ? `TDM ${mm}:${ss} · Team A ${st.teamScoreA} — ${st.teamScoreB} Team B`
          : `FFA ${mm}:${ss} · first to 25`;
      } else {
        matchEl.textContent = 'MATCH SELESAI';
      }
    }
    this.updateScoreboard();
  }
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function makeNameplate(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 42);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(1.6, 0.4, 1);
  return sp;
}

function el(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e;
}
