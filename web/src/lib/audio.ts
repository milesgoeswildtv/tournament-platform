import { getPrefs } from './prefs';
import { music } from './music';

/**
 * Short game sound effects are synthesized with WebAudio. Music playback is
 * handled separately by the configurable track player.
 * Browsers only allow audio after a tap, so everything starts lazily.
 */
type Sfx = 'tap' | 'lock' | 'tick' | 'reveal' | 'out' | 'safe' | 'start' | 'cash' | 'burst';

class Engine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
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
  }

  get musicPlaying() {
    return music.getSnapshot().playing;
  }

  syncMusic() { music.sync(); }

  setMusicVolume(v: number) { music.setVolume(v); }

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
    o.connect(this.env(t, vol, 0.005, 0.32, this.sfxBus));
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
