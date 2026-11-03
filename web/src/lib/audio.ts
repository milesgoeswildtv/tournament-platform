import { getPrefs } from './prefs';

/**
 * Sound, generated in the browser with WebAudio — no audio files, nothing to
 * license. Music is a low industrial loop (drone, room tone, a slow kick and
 * a shaker); effects are short synthesized cues for game moments.
 * Browsers only allow audio after a tap, so everything starts lazily.
 */
type Sfx = 'tap' | 'lock' | 'tick' | 'reveal' | 'out' | 'safe' | 'start' | 'cash' | 'burst';

const ROOTS = [55, 49, 58.27, 43.65];

class Engine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  private music: { stop: () => void } | null = null;

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0;
      this.musicBus.connect(this.master);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.5;
      this.sfxBus.connect(this.master);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Call from any user gesture so later cues are allowed to play. */
  unlock() {
    this.ensure();
    this.syncMusic();
  }

  get musicPlaying() {
    return !!this.music;
  }

  syncMusic() {
    const p = getPrefs();
    if (p.music) this.startMusic(p.musicVolume);
    else this.stopMusic();
  }

  setMusicVolume(v: number) {
    if (this.ctx && this.music) this.musicBus.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.2);
  }

  private startMusic(volume: number) {
    const ctx = this.ensure();
    if (!ctx) return;
    this.musicBus.gain.setTargetAtTime(volume * 0.5, ctx.currentTime, 0.6);
    if (this.music) return;

    const t0 = ctx.currentTime + 0.05;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 6;
    lp.connect(this.musicBus);
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.045;
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start(t0);

    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.22;
    droneGain.connect(lp);
    const oscs = [0, 0.4, -0.3].map((detune, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'square' : 'sawtooth';
      o.frequency.value = ROOTS[0] * (i === 2 ? 0.5 : 1) + detune;
      o.connect(droneGain);
      o.start(t0);
      return o;
    });

    const room = ctx.createBufferSource();
    room.buffer = this.noise;
    room.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.6;
    const roomGain = ctx.createGain();
    roomGain.gain.value = 0.035;
    room.connect(bp).connect(roomGain).connect(this.musicBus);
    room.start(t0);

    const bpm = 86;
    const beat = 60 / bpm;
    let next = t0;
    let step = 0;
    const schedule = () => {
      while (next < ctx.currentTime + 0.25) {
        const bar = Math.floor(step / 8);
        const pos = step % 8; // eighth notes
        if (pos === 0 || pos === 5) this.kick(next, 0.55);
        if (pos % 2 === 1) this.hat(next, pos === 3 || pos === 7 ? 0.05 : 0.025);
        if (pos === 4 && bar % 4 === 3) this.clank(next);
        if (pos === 0 && bar % 8 === 0) {
          const root = ROOTS[(bar / 8) % ROOTS.length];
          oscs.forEach((o, i) => o.frequency.setTargetAtTime(root * (i === 2 ? 0.5 : 1) + [0, 0.4, -0.3][i], next, 0.8));
        }
        next += beat / 2;
        step++;
      }
    };
    schedule();
    const timer = window.setInterval(schedule, 60);
    this.music = {
      stop: () => {
        window.clearInterval(timer);
        const t = ctx.currentTime;
        this.musicBus.gain.setTargetAtTime(0, t, 0.3);
        window.setTimeout(() => {
          oscs.forEach((o) => o.stop());
          lfo.stop();
          room.stop();
        }, 1500);
      },
    };
  }

  private stopMusic() {
    this.music?.stop();
    this.music = null;
  }

  private env(t: number, peak: number, attack: number, decay: number, bus: AudioNode): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(bus);
    return g;
  }

  private kick(t: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    o.connect(this.env(t, vol, 0.005, 0.32, this.musicBus));
    o.start(t);
    o.stop(t + 0.4);
  }

  private noiseHit(t: number, vol: number, type: BiquadFilterType, freq: number, decay: number, bus: AudioNode) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = type === 'bandpass' ? 8 : 0.7;
    s.connect(f).connect(this.env(t, vol, 0.002, decay, bus));
    s.start(t, Math.random());
    s.stop(t + decay + 0.05);
  }

  private hat(t: number, vol: number) {
    this.noiseHit(t, vol, 'highpass', 7000, 0.05, this.musicBus);
  }

  private clank(t: number) {
    this.noiseHit(t, 0.06, 'bandpass', 1250, 0.4, this.musicBus);
  }

  private tone(t: number, freq: number, vol: number, decay: number, type: OscillatorType = 'square', glideTo?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + decay);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    o.connect(f).connect(this.env(t, vol, 0.004, decay, this.sfxBus));
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  play(name: Sfx) {
    if (!getPrefs().sfx) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    switch (name) {
      case 'tap':
        return this.noiseHit(t, 0.12, 'bandpass', 2200, 0.03, this.sfxBus);
      case 'lock':
        this.noiseHit(t, 0.25, 'bandpass', 900, 0.06, this.sfxBus);
        return this.tone(t + 0.02, 220, 0.12, 0.12);
      case 'tick':
        return this.tone(t, 1320, 0.05, 0.04, 'square');
      case 'reveal':
        this.kick(t, 0.5);
        return this.noiseHit(t, 0.15, 'lowpass', 400, 0.5, this.sfxBus);
      case 'out':
        this.tone(t, 110, 0.18, 0.6, 'sawtooth', 55);
        return this.tone(t, 116, 0.12, 0.6, 'sawtooth', 58);
      case 'safe':
        this.tone(t, 440, 0.08, 0.18, 'triangle');
        return this.tone(t + 0.09, 660, 0.08, 0.3, 'triangle');
      case 'start':
        for (let i = 0; i < 3; i++) this.tone(t + i * 0.12, 330 + i * 110, 0.07, 0.1, 'square');
        return;
      case 'cash':
        return this.tone(t, 880, 0.08, 0.25, 'triangle', 1320);
      case 'burst':
        this.noiseHit(t, 0.4, 'lowpass', 1800, 0.7, this.sfxBus);
        return this.kick(t, 0.8);
    }
  }
}

export const audio = new Engine();

export function haptic(kind: 'light' | 'heavy' | 'error' | 'success' = 'light') {
  if (!getPrefs().haptics) return;
  const tg = (window as unknown as { Telegram?: { WebApp?: { HapticFeedback?: { impactOccurred(s: string): void; notificationOccurred(s: string): void } } } }).Telegram?.WebApp?.HapticFeedback;
  if (tg) {
    if (kind === 'error' || kind === 'success') tg.notificationOccurred(kind);
    else tg.impactOccurred(kind === 'heavy' ? 'heavy' : 'light');
    return;
  }
  navigator.vibrate?.(kind === 'heavy' ? 40 : kind === 'error' ? [30, 40, 30] : kind === 'success' ? [15, 30, 15] : 12);
}
