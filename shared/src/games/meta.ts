import type { GameId } from '../types';
import type { GameMeta } from './common';

/**
 * Rules text and limits for every game. Kept apart from the game logic so the
 * browser bundle can show rules without ever containing puzzle answers or
 * task libraries (scripts/build-web.mjs fails the build if they leak).
 */
export const GAME_META_DATA: Record<GameId, GameMeta> = {
  'guess-color': {
    id: 'guess-color',
    name: 'Guess the Color',
    tagline: 'Five cans. One is live.',
    description: 'Pick one of five colors. The house draws one at random. Match it to stay in.',
    instructions: [
      'Pick one of the five colors before the timer runs out. Your pick locks.',
      'The server draws the winning color after picks close.',
      'Match it and you survive. Miss it, or pick nothing, and you are out.',
      'If every remaining player misses, the round is void and replays.',
    ],
    minPlayers: 1,
    maxPlayers: 1000,
    maxRounds: 6,
    roundNoun: 'Draw',
    winRule: 'Last player standing wins the stage.',
    tieRule: 'If more than one player is still standing after 6 draws, they share the stage win.',
  },
  'zero-hour': {
    id: 'zero-hour',
    name: 'Zero Hour',
    tagline: 'Out-think the room.',
    description: 'Everyone picks 0–100 in secret. The target is a set percentage of the average. Closest wins.',
    instructions: [
      'Enter a whole number from 0 to 100. It stays hidden until the round closes.',
      'The target is the configured percentage of everyone’s average.',
      'Closest to the target wins the stage. One submission, no changes.',
    ],
    minPlayers: 1,
    maxPlayers: 1000,
    maxRounds: 1,
    roundNoun: 'Call',
    winRule: 'Closest number to the target wins.',
    tieRule: 'Equal distance: the earlier submission (server time) wins; identical times fall to a server-drawn order.',
  },
  'high-low': {
    id: 'high-low',
    name: 'Trust Yourself',
    tagline: 'Keep it or burn it. Then call it.',
    description: 'You get a secret number from 1–100. Keep it or reroll once, then call HIGH or LOW against the house number.',
    instructions: [
      'You are dealt a private number from 1 to 100.',
      'Keep it, or reroll once. A reroll is final — you play the new number.',
      'Call HIGH if you think yours beats the house number, LOW if it falls under.',
      'Ties with the house are eliminated. No call before time is up means you are out.',
    ],
    minPlayers: 1,
    maxPlayers: 1000,
    maxRounds: 5,
    roundNoun: 'Hand',
    winRule: 'Last player standing wins the stage.',
    tieRule: 'If more than one player survives 5 hands, they share the stage win.',
  },
  'decode': {
    id: 'decode',
    name: 'Decode',
    tagline: 'Same board. Who cracks it first?',
    description: 'Everyone gets the same hidden phrase. One guess per round; each round reveals more.',
    instructions: [
      'Everyone sees the same masked phrase and its category.',
      'You get one private guess per round. Spelling and spacing are forgiven; letters are not.',
      'Round 2 adds a clue. Round 3 adds a second clue and reveals the vowels.',
      'The first correct guess (by server time) wins the stage. Unsolved after 3 rounds: no winner.',
    ],
    minPlayers: 1,
    maxPlayers: 1000,
    maxRounds: 3,
    roundNoun: 'Round',
    winRule: 'Earliest correct guess wins.',
    tieRule: 'Guesses are ordered by server receive time; identical times fall to a server-drawn order.',
  },
  'suited-up': {
    id: 'suited-up',
    name: 'Suited Up',
    tagline: 'Read the dealer’s pair.',
    description: 'Pick a suit. The dealer shows two different suits. Score each matchup; stay at zero or better.',
    instructions: [
      'Spade beats Diamond. Diamond beats Club. Club beats Heart. Heart beats Spade.',
      'Any other pairing, or the same suit, is neutral.',
      'Pick one suit. The dealer then reveals two different suits.',
      'Each matchup: win +1, neutral 0, loss −1. Total 0 or better survives; −1 is out.',
    ],
    minPlayers: 1,
    maxPlayers: 1000,
    maxRounds: 5,
    roundNoun: 'Deal',
    winRule: 'Last player standing wins the stage.',
    tieRule: 'Still tied after 5 deals: highest running score wins; equal scores share the stage.',
  },
  'pressure-cooker': {
    id: 'pressure-cooker',
    name: 'Pressure Cooker',
    tagline: 'Hold your nerve. Not too long.',
    description: 'A multiplier climbs until the pressure breaks at a hidden moment. Cash out before it does.',
    instructions: [
      'The multiplier starts at 1.00× and climbs.',
      'Tap CASH OUT to lock your multiplier. The server records the exact moment it receives your tap.',
      'The break point is hidden and drawn by the server. If it breaks before you cash out, you are out.',
      'Highest locked multiplier wins the stage. If everyone busts, the round replays (up to 3 times).',
    ],
    minPlayers: 1,
    maxPlayers: 1000,
    maxRounds: 3,
    roundNoun: 'Run',
    winRule: 'Highest locked multiplier wins.',
    tieRule: 'Equal multipliers: the later server-recorded cash-out (higher exact value) wins; identical times fall to a server-drawn order.',
  },
  'speedrun': {
    id: 'speedrun',
    name: 'Randomizer Speedrun',
    tagline: 'Fast and right, or gone.',
    description: 'A random task every round — math, words, reading, observation, trivia, directions, lookups. Speed matters.',
    instructions: [
      'Each round serves a random task from a controlled library. One answer per round.',
      'Wrong answers and no answer are eliminated.',
      'Rounds 1–5 cut at least 1 player, rounds 6–10 cut 1–2, rounds 11+ cut 1–3. If too few are wrong, the slowest correct answers are cut.',
      'At least one player always survives a round. If nobody is right, the round is void.',
    ],
    minPlayers: 1,
    maxPlayers: 1000,
    maxRounds: 12,
    roundNoun: 'Task',
    winRule: 'Last player standing wins the stage.',
    tieRule: 'Still more than one after 12 tasks: lowest total answer time wins; exact ties fall to a server-drawn order.',
  },
};

export const COLORS = ['red', 'yellow', 'green', 'blue', 'white'] as const;
export const SUITS = ['spade', 'diamond', 'club', 'heart'] as const;

