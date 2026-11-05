import { getPrefs } from './prefs';

export type MusicScreen = 'lobby' | 'gameplay';
export type MusicCategory = 'underground' | 'drift' | 'oddity';

export const MUSIC_CATEGORIES: { id: MusicCategory; label: string; description: string }[] = [
  { id: 'underground', label: 'UNDERGROUND', description: 'Industrial hip-hop, experimental trap and dark electronic.' },
  { id: 'drift', label: 'DRIFT', description: 'Atmospheric, spacious and downtempo electronic.' },
  { id: 'oddity', label: 'ODDITY', description: 'Offbeat synths, elastic bass and strange electronic grooves.' },
];

export interface MusicTrack { id: string; title: string; category: MusicCategory; src: string; }

// Add a file under public/music/<category>/ and one entry here. The controller
// owns playback, playlist selection, browser unlock and recovery in one place.
export const MUSIC_LIBRARY: MusicTrack[] = [
  { id: 'underground-bad-signal', title: 'BAD SIGNAL', category: 'underground', src: '/music/underground/BAD%20SIGNAL%20-%20LOST%20CRASHOUT.mp3' },
  { id: 'underground-basement-anthem', title: 'BASEMENT ANTHEM', category: 'underground', src: '/music/underground/BASEMENT%20ANTHEM%20-%20LOST%20CRASHOUT.mp3' },
  { id: 'underground-blackout', title: 'BLACKOUT', category: 'underground', src: '/music/underground/BLACKOUT%20-%20LOST%20CRASHOUT.mp3' },
  { id: 'underground-crooked-underground', title: 'CROOKED UNDERGROUND', category: 'underground', src: '/music/underground/CROOKED%20UNDERGROUND%20-%20LOST%20CRASHOUT.mp3' },
  { id: 'underground-no-mercy', title: 'NO MERCY', category: 'underground', src: '/music/underground/NO%20MERCY%20-%20LOST%20CRASHOUT.mp3' },
  { id: 'drift-low-profile', title: 'LOW PROFILE', category: 'drift', src: '/music/drift/LOW%20PROFILE%20-%20LOST%20CRASHOUT.mp3' },
  { id: 'drift-nightshift', title: 'NIGHTSHIFT', category: 'drift', src: '/music/drift/NIGHTSHIFT%20-%20LOST%20CRASHOUT.mp3' },
  { id: 'oddity-cracked-frequency', title: 'CRACKED FREQUENCY', category: 'oddity', src: '/music/oddity/CRACKED%20FREQUENCY%20-%20LOST%20CRASHOUT.mp3' },
  { id: 'oddity-parasite-radio', title: 'PARASITE RADIO', category: 'oddity', src: '/music/oddity/PARASITE%20RADIO%20-%20LOST%20CRASHOUT.mp3' },
];

type Snapshot = {
  track: MusicTrack | null;
  playing: boolean;
  screen: MusicScreen;
  available: number;
  shuffle: boolean;
  error: string | null;
};

class MusicController {
  private element: HTMLAudioElement | null = null;
  private screen: MusicScreen = 'lobby';
  private current: MusicTrack | null = null;
  private listeners = new Set<() => void>();
  private manualPause = false;
  private failedTracks = new Set<string>();
  private unlocked = false;
  private shuffle = false;
  private playbackError: string | null = null;
  private isPlaying = false;
  private snapshot: Snapshot = {
    track: null, playing: false, screen: 'lobby', available: 0, shuffle: false, error: null,
  };

  private audioElement(): HTMLAudioElement | null {
    if (typeof Audio === 'undefined') return null;
    if (!this.element) {
      const el = new Audio();
      el.preload = 'auto';
      el.addEventListener('play', () => { this.playbackError = null; });
      el.addEventListener('playing', () => { this.isPlaying = true; this.publish(); });
      el.addEventListener('pause', () => { this.isPlaying = false; this.publish(); });
      el.addEventListener('waiting', () => { this.isPlaying = false; this.publish(); });
      el.addEventListener('ended', () => this.next());
      el.addEventListener('error', () => this.handleTrackError());
      this.element = el;
    }
    return this.element;
  }

  private playlist(): MusicTrack[] {
    const prefs = getPrefs();
    const categories = new Set(
      this.screen === 'lobby' ? prefs.lobbyMusicCategories : prefs.gameplayMusicCategories,
    );
    return MUSIC_LIBRARY.filter(
      (track) => categories.has(track.category) && !this.failedTracks.has(track.id),
    );
  }

  private publish() {
    const el = this.element;
    this.snapshot = {
      track: this.current,
      playing: this.isPlaying && !!el && !el.paused && !el.ended,
      screen: this.screen,
      available: this.playlist().length,
      shuffle: this.shuffle,
      error: this.playbackError,
    };
    this.listeners.forEach((listener) => listener());
  }

  private playCurrent() {
    const el = this.audioElement();
    if (!el || !this.current || !getPrefs().music || !this.unlocked || this.manualPause) {
      this.publish();
      return;
    }

    // Keep play() directly in the user-activation call path when unlocking.
    // iOS Safari requires this gesture before it will permit audible playback.
    void el.play().then(() => {
      this.playbackError = null;
      this.publish();
    }).catch((error: unknown) => {
      const name = error instanceof DOMException ? error.name : '';
      this.playbackError = name === 'NotAllowedError'
        ? 'Tap the page or Play to allow audio.'
        : 'Playback could not start. Try Play again.';
      this.publish();
    });
  }

  private handleTrackError() {
    if (this.current) this.failedTracks.add(this.current.id);
    this.playbackError = 'This track could not be loaded. Skipping it.';
    this.current = null;
    const el = this.element;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    const next = this.playlist()[0] ?? null;
    this.select(next, false);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  /** Called from the app's first real pointer interaction. */
  unlock() {
    this.unlocked = true;
    if (!this.current) this.select(this.playlist()[0] ?? null, false);
    else this.playCurrent();
  }

  setScreen(screen: MusicScreen) {
    if (this.screen === screen) return;
    const wasPlaying = !!this.element && !this.element.paused;
    this.screen = screen;
    const list = this.playlist();
    if (this.current && list.some((track) => track.id === this.current!.id)) {
      this.publish();
      return;
    }
    this.select(list[0] ?? null, wasPlaying);
  }

  sync() {
    const el = this.audioElement();
    if (!el) return;
    const prefs = getPrefs();
    el.volume = Math.max(0, Math.min(1, prefs.musicVolume));

    if (!prefs.music) {
      el.pause();
      this.publish();
      return;
    }

    const list = this.playlist();
    if (this.current && list.some((track) => track.id === this.current!.id)) {
      if (el.paused && !this.manualPause) this.playCurrent();
      else this.publish();
      return;
    }

    this.select(list[0] ?? null, false);
  }

  setVolume(value: number) {
    const el = this.audioElement();
    if (el) el.volume = Math.max(0, Math.min(1, value));
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    this.publish();
  }

  togglePlayback() {
    if (!getPrefs().music) return;
    const el = this.audioElement();
    if (!el) return;

    if (!el.paused) {
      this.manualPause = true;
      el.pause();
      this.publish();
      return;
    }

    this.manualPause = false;
    this.unlocked = true;
    if (!this.current) this.select(this.playlist()[0] ?? null, false);
    else this.playCurrent();
  }

  next() {
    const list = this.playlist();
    if (!list.length) {
      this.select(null, false);
      return;
    }
    const index = this.current ? list.findIndex((track) => track.id === this.current!.id) : -1;
    const nextIndex = list.length > 1 && this.shuffle
      ? (index + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length
      : (index + 1) % list.length;
    this.manualPause = false;
    this.select(list[nextIndex], false);
  }

  previous() {
    const list = this.playlist();
    if (!list.length) {
      this.select(null, false);
      return;
    }
    const index = this.current ? list.findIndex((track) => track.id === this.current!.id) : 0;
    this.manualPause = false;
    this.select(list[(index - 1 + list.length) % list.length], false);
  }

  private select(track: MusicTrack | null, preservePlayback: boolean) {
    const el = this.audioElement();
    if (!el) return;
    const wasPlaying = !el.paused;
    const hadTrack = !!this.current;

    el.pause();
    this.isPlaying = false;
    this.current = track;
    this.playbackError = null;

    if (!track) {
      el.removeAttribute('src');
      el.load();
      this.publish();
      return;
    }

    el.src = track.src;
    el.load();
    el.volume = Math.max(0, Math.min(1, getPrefs().musicVolume));

    const shouldPlay = getPrefs().music
      && this.unlocked
      && !this.manualPause
      && (!preservePlayback || wasPlaying || !hadTrack);

    if (shouldPlay) this.playCurrent();
    else this.publish();
  }
}

export const music = new MusicController();
