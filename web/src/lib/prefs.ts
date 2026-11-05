import { useSyncExternalStore } from 'react';

/** Per-device preferences. Conveniences only, so storage failures are harmless. */
export interface Prefs {
  music: boolean;
  musicVolume: number; // 0..1\n  lobbyMusicCategories: ('underground' | 'drift' | 'oddity')[];\n  gameplayMusicCategories: ('underground' | 'drift' | 'oddity')[]
  sfx: boolean;
  haptics: boolean;
  motion: 'system' | 'reduced';
}

const KEY = 'tp.prefs.v1';
const DEFAULTS: Prefs = { music: false, musicVolume: 0.4, lobbyMusicCategories: ['underground'], gameplayMusicCategories: ['oddity'], sfx: true, haptics: true, motion: 'system' };

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return { ...DEFAULTS };
  }
}

let prefs = load();
const subs = new Set<() => void>();

function apply() {
  document.documentElement.dataset.motion = prefs.motion === 'reduced' ? 'reduced' : '';
}
apply();

export function setPrefs(p: Partial<Prefs>) {
  prefs = { ...prefs, ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
  apply();
  subs.forEach((f) => f());
}

export const getPrefs = () => prefs;

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => prefs,
  );
}
