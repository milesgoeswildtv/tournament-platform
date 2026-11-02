/**
 * Randomness used for competitive outcomes.
 *
 * Production code uses `secureRng`, backed by crypto.getRandomValues with
 * rejection sampling so every integer in a range is exactly equally likely.
 * `seededRng` exists only so tests can reproduce sequences.
 */
export interface Rng {
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Uniform float in [0, 1). */
  float(): number;
}

const U32 = 0x1_0000_0000;

function secureU32(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

export const secureRng: Rng = {
  int(min, max) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new Error(`bad range ${min}..${max}`);
    }
    const span = max - min + 1;
    if (span > U32) throw new Error('range too large');
    // Reject the biased tail so the result is uniform.
    const limit = U32 - (U32 % span);
    let x = secureU32();
    while (x >= limit) x = secureU32();
    return min + (x % span);
  },
  float() {
    // 53 bits of entropy from two draws.
    const hi = secureU32() >>> 5;
    const lo = secureU32() >>> 6;
    return (hi * 67108864 + lo) / 9007199254740992;
  },
};

/** Deterministic generator for tests and simulations (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / U32;
  };
  return {
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    float: next,
  };
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick from empty list');
  return items[rng.int(0, items.length - 1)];
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function randomCode(rng: Rng, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[rng.int(0, CODE_ALPHABET.length - 1)];
  return s;
}
