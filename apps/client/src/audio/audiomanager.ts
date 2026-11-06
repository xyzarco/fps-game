// Fase 5: Web Audio manager — SFX + positional 3D audio untuk tembakan/step pemain lain.
// Autoplay policy: AudioContext dibuat/resume setelah gesture pertama (pointer lock click).
class AudioManager {
  ctx: AudioContext | null = null;
  buffers = new Map<string, AudioBuffer>();
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  volume = 0.7;

  /** Call from a user gesture. Idempotent. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 1;
    this.sfxGain.connect(this.master);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
    localStorage.setItem('fps.volume', String(v));
  }

  async load(name: string, url: string) {
    if (this.buffers.has(name)) return;
    if (!this.ctx) this.unlock();
    if (!this.ctx) return;
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    this.buffers.set(name, await this.ctx.decodeAudioData(arr));
  }

  /** Simple 2D SFX. */
  play(name: string, gain = 1, rate = 1) {
    if (!this.ctx || !this.sfxGain) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.sfxGain);
    src.start();
  }

  /** Positional 3D: play at world position relative to listener. */
  playAt(name: string, dx: number, dy: number, dz: number, refDist = 6) {
    if (!this.ctx || !this.sfxGain) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const dist = Math.hypot(dx, dy, dz);
    const gain = Math.max(0.05, Math.min(1, refDist / Math.max(refDist, dist)));
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const panner = this.ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = refDist;
    panner.positionX.value = dx;
    panner.positionY.value = dy;
    panner.positionZ.value = dz;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(panner).connect(this.sfxGain);
    src.start();
  }
}

export const audio = new AudioManager();
