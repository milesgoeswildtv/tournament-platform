import type { GameId } from '@shared/client';

/** Each game's own light within the shared palette. */
export const GAME_ACCENT: Record<GameId, string> = {
  'guess-color': '#efc93c',
  'zero-hour': '#bde2e4',
  'high-low': '#86d17a',
  decode: '#ece7db',
  'suited-up': '#ee4b3b',
  'pressure-cooker': '#f5a23a',
  speedrun: '#6fa8ff',
};

const CANS = ['var(--can-red)', 'var(--can-yellow)', 'var(--can-green)', 'var(--can-blue)', 'var(--can-white)'];

export type SuitName = 'spade' | 'diamond' | 'club' | 'heart';

const SUIT_PATH: Record<SuitName, string> = {
  heart: 'M24 41 8.5 25.5a9 9 0 0 1 12.7-12.7L24 15.6l2.8-2.8a9 9 0 0 1 12.7 12.7z',
  diamond: 'M24 5 39 24 24 43 9 24z',
  spade: 'M24 6 39.5 21.5a9 9 0 0 1-12.7 12.7L25.5 33 28 42H20l2.5-9-1.3 1.2A9 9 0 0 1 8.5 21.5z',
  club: 'M24 6a8 8 0 0 1 6.9 12A8 8 0 1 1 26 32.4L28 42h-8l2-9.6A8 8 0 1 1 17.1 18 8 8 0 0 1 24 6z',
};

export const SUIT_COLOR: Record<SuitName, string> = {
  spade: 'var(--chalk)',
  club: 'var(--chalk)',
  heart: 'var(--stop)',
  diamond: 'var(--stop)',
};

export function SuitGlyph({ suit, size = 40, color }: { suit: SuitName; size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden>
      <path d={SUIT_PATH[suit]} fill={color ?? SUIT_COLOR[suit]} />
    </svg>
  );
}

/** Small emblem that identifies a game wherever it appears (lineups, library, results). */
export function GameMark({ id, size = 40 }: { id: GameId | null; size?: number }) {
  const a = id ? GAME_ACCENT[id] : 'var(--ash)';
  const common = { width: size, height: size, viewBox: '0 0 48 48', 'aria-hidden': true } as const;
  switch (id) {
    case 'guess-color':
      return (
        <svg {...common}>
          {CANS.map((c, i) => (
            <rect key={i} x={5 + i * 8} y={10 + (i % 2) * 4} width={6} height={28 - (i % 2) * 4} fill={c} />
          ))}
        </svg>
      );
    case 'zero-hour':
      return (
        <svg {...common} fill="none" stroke={a} strokeWidth={3}>
          <circle cx="24" cy="24" r="17" />
          <path d="M24 7v6M24 35v6M7 24h6M35 24h6" />
          <circle cx="24" cy="24" r="4" fill={a} stroke="none" />
        </svg>
      );
    case 'high-low':
      return (
        <svg {...common} fill="none" stroke={a} strokeWidth={4} strokeLinecap="square">
          <path d="M15 34V12M7 20l8-8 8 8" />
          <path d="M33 14v22M25 28l8 8 8-8" opacity={0.55} />
        </svg>
      );
    case 'decode':
      return (
        <svg {...common}>
          <rect x="4" y="15" width="11" height="15" fill="none" stroke={a} strokeWidth={2.5} />
          <rect x="18.5" y="15" width="11" height="15" fill={a} />
          <rect x="33" y="15" width="11" height="15" fill="none" stroke={a} strokeWidth={2.5} />
          <rect x="4" y="35" width="40" height="3" fill={a} opacity={0.5} />
        </svg>
      );
    case 'suited-up':
      return (
        <svg {...common}>
          <path d={SUIT_PATH.spade} fill={a} transform="translate(2 2) scale(.92)" />
        </svg>
      );
    case 'pressure-cooker':
      return (
        <svg {...common} fill="none" stroke={a} strokeWidth={3}>
          <path d="M7 34a17 17 0 0 1 34 0" />
          <path d="M24 34 34 18" strokeWidth={3.5} />
          <circle cx="24" cy="34" r="3.5" fill={a} />
          <path d="M11 22l3 2M37 22l-3 2M24 14v4" />
        </svg>
      );
    case 'speedrun':
      return (
        <svg {...common} fill="none" stroke={a} strokeWidth={3}>
          <circle cx="24" cy="27" r="15" />
          <path d="M20 6h8M24 6v6M24 27l7-7M38 13l3-3" />
        </svg>
      );
    default:
      return (
        <svg {...common} fill="none" stroke={a} strokeWidth={3}>
          <rect x="8" y="8" width="32" height="32" strokeDasharray="5 4" />
          <path d="M19 19a5 5 0 1 1 7 4.6c-1.3.6-2 1.6-2 3V28M24 33v.5" />
        </svg>
      );
  }
}
