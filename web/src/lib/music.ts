import { getPrefs } from './prefs';

export type MusicScreen = 'lobby' | 'gameplay';
export type MusicCategory = 'underground' | 'drift' | 'oddity';

export const MUSIC_CATEGORIES: { id: MusicCategory; label: string; description: string }[] = [
  { id: 'underground', label: 'UNDERGROUND', description: 'Industrial hip-hop, experimental trap and dark electronic.' },
  { id: 'drift', label: 'DRIFT', description: 'Atmospheric, spacious and downtempo electronic.' },
  { id: 'oddity', label: 'ODDITY', description: 'Offbeat synths, elastic bass and strange electronic grooves.' },
];

export interface MusicTrack { id: string; title: string; category: MusicCategory; src: string; }

// Add a file under public/music/<category>/ and one entry here. No player or
// settings changes are needed when the library grows.
export const MUSIC_LIBRARY: MusicTrack[] = [];

type Snapshot = { track: MusicTrack | null; playing: boolean; screen: MusicScreen; available: number };

class MusicController {
  private element: HTMLAudioElement | null = null;
  private gain: GainNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private screen: MusicScreen = 'lobby';
  private current: MusicTrack | null = null;
  private listeners = new Set<() => void>();
  private manualPause = false;
  private failedTracks = new Set<string>();
  private unlocked = false;
  private snapshot: Snapshot = { track: null, playing: false, screen: 'lobby', available: 0 };

  private audioElement() {
    if (!this.element && typeof Audio !== 'undefined') {
      this.element = new Audio();
      this.element.preload = 'metadata';
      this.element.addEventListener('ended', () => this.next());
      this.element.addEventListener('play', () => this.publish());
      this.element.addEventListener('pause', () => this.publish());
      this.element.addEventListener('error', () => {
        if (this.current) this.failedTracks.add(this.current.id);
        this.element!.removeAttribute('src');
        this.element!.load();
        this.current = null;
        this.next();
      });
    }
    return this.element;
  }

  private playlist() {
    const p = getPrefs();
    const enabled = new Set(this.screen === 'lobby' ? p.lobbyMusicCategories : p.gameplayMusicCategories);
    return MUSIC_LIBRARY.filter((track) => enabled.has(track.category) && !this.failedTracks.has(track.id));
  }

  private publish() {
    const el = this.element;
    this.snapshot = { track: this.current, playing: !!el && !el.paused && !el.ended, screen: this.screen, available: this.playlist().length };
    this.listeners.forEach((fn) => fn());
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getSnapshot = () => this.snapshot;

  connectAudioContext(context: AudioContext) {
    const el = this.audioElement();
    if (!el || this.source) return;
    try {
      this.source = context.createMediaElementSource(el);
      this.gain = context.createGain();
      this.gain.gain.value = getPrefs().musicVolume;
      this.source.connect(this.gain).connect(context.destination);
      el.volume = 1;
    } catch {
      this.source = null;
      this.gain = null;
    }
  }

  unlock() { this.unlocked = true; this.sync(); }

  setScreen(screen: MusicScreen) {
    if (this.screen === screen) return;
    this.screen = screen;
    const list = this.playlist();
    if (this.current && list.some((track) => track.id === this.current!.id)) return this.publish();
    this.select(list[0] ?? null, true);
  }

  sync() {
    const el = this.audioElement();
    if (!el) return;
    const p = getPrefs();
    if (this.gain) this.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, p.musicVolume)), this.gain.context.currentTime, 0.04);
    else el.volume = Math.max(0, Math.min(1, p.musicVolume));
    if (!p.music) { el.pause(); this.publish(); return; }
    const list = this.playlist();
    if (this.current && list.some((track) => track.id === this.current!.id)) {
      if (this.unlocked && !this.manualPause && el.paused) void el.play().catch(() => this.publish());
      this.publish();
      return;
    }
    this.select(list[0] ?? null, true);
  }

  setVolume(value: number) {
    const v = Math.max(0, Math.min(1, value));
    const el = this.audioElement();
    if (this.gain) this.gain.gain.setTargetAtTime(v, this.gain.context.currentTime, 0.04);
    else if (el) el.volume = v;
  }

  togglePlayback() {
    if (!getPrefs().music) return;
    const el = this.audioElement();
    if (!el) return;
    if (!el.paused) { this.manualPause = true; el.pause(); }
    else {
      this.manualPause = false;
      this.unlocked = true;
      if (!this.current) this.select(this.playlist()[0] ?? null, false);
      if (this.current) void el.play().catch(() => this.publish());
    }
    this.publish();
  }

  next() {
    const list = this.playlist();
    if (!list.length) return this.select(null, false);
    const index = this.current ? list.findIndex((track) => track.id === this.current!.id) : -1;
    const nextIndex = list.length > 1 ? (index + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length : 0;
    this.manualPause = false;
    this.select(list[nextIndex], false);
  }

  previous() {
    const list = this.playlist();
    if (!list.length) return this.select(null, false);
    const index = this.current ? list.findIndex((track) => track.id === this.current!.id) : 0;
    this.manualPause = false;
    this.select(list[(index - 1 + list.length) % list.length], false);
  }

  private select(track: MusicTrack | null, preservePause: boolean) {
    const el = this.audioElement();
    if (!el) return;
    const wasPlaying = !el.paused;
    el.pause();
    this.current = track;
    if (!track) { el.removeAttribute('src'); el.load(); this.publish(); return; }
    el.src = track.src;
    el.load();
    if (this.gain) this.gain.gain.setTargetAtTime(getPrefs().musicVolume, this.gain.context.currentTime, 0.04);
    else el.volume = getPrefs().musicVolume;
    const shouldPlay = getPrefs().music && this.unlocked && !this.manualPause && (!preservePause || wasPlaying || !this.snapshot.track);
    if (shouldPlay) void el.play().catch(() => this.publish());
    this.publish();
  }
}

export const music = new MusicController();
