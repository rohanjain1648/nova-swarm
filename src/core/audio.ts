/**
 * Fully procedural audio via the Web Audio API — no sample files to ship.
 *
 * SFX are short synthesized blips with amplitude envelopes; music is a slow
 * evolving arpeggio over a minor pentatonic scale scheduled ahead of the clock.
 * The context is created lazily and resumed on the first user gesture (browser
 * autoplay policy), which the title screen provides.
 */

const MUTE_KEY = "novaswarm.muted";

type Wave = OscillatorType;

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private sfxGain!: GainNode;
  muted: boolean;

  // Music scheduler state
  private nextNoteTime = 0;
  private step = 0;
  private schedulerTimer = 0;
  private musicOn = false;
  private intensity = 0; // 0..1, ramps with game difficulty

  constructor() {
    this.muted = localStorage.getItem(MUTE_KEY) === "1";
  }

  /** Must be called from within a user-gesture handler. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.35;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 1;
    this.sfxGain.connect(this.master);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.now);
      this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.9, this.now + 0.05);
    }
    return this.muted;
  }

  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
  }

  private get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Core one-shot voice: oscillator → gain envelope → destination. */
  private blip(
    freq: number,
    dur: number,
    type: Wave,
    gain: number,
    sweepTo?: number,
    dest?: AudioNode,
  ): void {
    if (!this.ctx || this.muted) return;
    const t = this.now;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweepTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(dest ?? this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, hp = 800): void {
    if (!this.ctx || this.muted) return;
    const t = this.now;
    const frames = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // --- SFX API -------------------------------------------------------------
  shoot(): void {
    this.blip(720 + Math.random() * 60, 0.08, "square", 0.06, 320);
  }
  hit(): void {
    this.blip(220, 0.05, "triangle", 0.05, 120);
  }
  kill(): void {
    this.blip(160, 0.16, "sawtooth", 0.09, 40);
    this.noise(0.12, 0.06, 500);
  }
  bigKill(): void {
    this.blip(90, 0.4, "sawtooth", 0.14, 30);
    this.noise(0.35, 0.12, 300);
  }
  hurt(): void {
    this.blip(200, 0.3, "sawtooth", 0.16, 60);
    this.noise(0.2, 0.1, 200);
  }
  pickup(): void {
    this.blip(880, 0.06, "sine", 0.05, 1200);
  }
  levelup(): void {
    const seq = [523.25, 659.25, 783.99, 1046.5];
    seq.forEach((f, i) => setTimeout(() => this.blip(f, 0.18, "triangle", 0.09, f), i * 70));
  }
  ui(): void {
    this.blip(600, 0.05, "sine", 0.06, 900);
  }
  bossWarn(): void {
    this.blip(120, 0.6, "sawtooth", 0.12, 90);
  }

  // --- Music ---------------------------------------------------------------
  startMusic(): void {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.nextNoteTime = this.now + 0.1;
    this.step = 0;
    this.schedule();
  }

  stopMusic(): void {
    this.musicOn = false;
    clearTimeout(this.schedulerTimer);
  }

  private schedule = (): void => {
    if (!this.ctx || !this.musicOn) return;
    // A minor pentatonic bassline + arp; density rises with intensity.
    const scale = [55, 65.41, 73.42, 82.41, 98, 110];
    while (this.nextNoteTime < this.now + 0.2) {
      const beat = this.step % 8;
      // Bass on beats 0 and 4
      if (beat === 0 || beat === 4) {
        this.blip(55, 0.5, "sine", 0.18, 55, this.musicGain);
      }
      // Arp notes, denser as intensity climbs
      if (Math.random() < 0.25 + this.intensity * 0.5) {
        const f = scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.5 ? 2 : 4);
        this.blip(f, 0.25, "triangle", 0.05 + this.intensity * 0.04, f, this.musicGain);
      }
      const stepDur = 0.24 - this.intensity * 0.05;
      this.nextNoteTime += stepDur;
      this.step++;
    }
    this.schedulerTimer = window.setTimeout(this.schedule, 60);
  };
}
