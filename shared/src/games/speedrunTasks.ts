import { pick, shuffle, type Rng } from '../rng';
import { normalizeAnswer } from './common';

export type TaskKind = 'math' | 'wordplay' | 'reading' | 'observation' | 'knowledge' | 'navigation' | 'research';

export interface Task {
  kind: TaskKind;
  prompt: string;
  /** Supporting material: a passage, a symbol strip, or a reference table. */
  detail?: string | { columns: string[]; rows: string[][] };
  input: 'number' | 'text' | 'choice';
  options?: string[];
  answer: string;
  accept?: string[];
  /** How a submission is judged. */
  evaluation: 'numeric' | 'normalized-text' | 'exact-choice';
}

export function evaluateTask(t: Task, submitted: string): boolean {
  if (typeof submitted !== 'string') return false;
  const s = submitted.trim();
  if (!s) return false;
  if (t.evaluation === 'numeric') {
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) && n === Number(t.answer);
  }
  if (t.evaluation === 'exact-choice') return s === t.answer;
  const norm = normalizeAnswer(s);
  return [t.answer, ...(t.accept ?? [])].some((a) => normalizeAnswer(a) === norm);
}

function withOptions(rng: Rng, answer: string, distractors: string[]): string[] {
  const uniq = [...new Set(distractors.filter((d) => d !== answer))].slice(0, 3);
  return shuffle(rng, [answer, ...uniq]);
}

const WORDS = ['ANCHOR', 'BRIDGE', 'CANVAS', 'DRIFT', 'EMBER', 'FORGE', 'GRAVEL', 'HARBOR', 'IRONS', 'JACKET', 'KERNEL', 'LANTERN', 'MAGNET', 'NEEDLE', 'ORBIT', 'PISTON', 'QUARRY', 'RIVET', 'SIGNAL', 'TUNNEL', 'VELVET', 'WIDGET', 'ZIPPER', 'BASEMENT', 'CONCRETE', 'GARAGE', 'SPRAY'];

const KNOWLEDGE: { q: string; a: string; d: string[] }[] = [
  { q: 'How many sides does a hexagon have?', a: '6', d: ['5', '7', '8'] },
  { q: 'Which planet is known as the Red Planet?', a: 'Mars', d: ['Venus', 'Jupiter', 'Mercury'] },
  { q: 'What is the chemical symbol for iron?', a: 'Fe', d: ['Ir', 'In', 'F'] },
  { q: 'How many minutes are in 3 hours?', a: '180', d: ['120', '160', '200'] },
  { q: 'Which ocean is the largest?', a: 'Pacific', d: ['Atlantic', 'Indian', 'Arctic'] },
  { q: 'What gas do plants absorb from the air?', a: 'Carbon dioxide', d: ['Oxygen', 'Nitrogen', 'Helium'] },
  { q: 'How many players are on a soccer team on the field?', a: '11', d: ['9', '10', '12'] },
  { q: 'Which is the longest bone in the human body?', a: 'Femur', d: ['Tibia', 'Humerus', 'Spine'] },
  { q: 'What is the freezing point of water in Celsius?', a: '0', d: ['32', '-10', '100'] },
  { q: 'Which continent is Egypt in?', a: 'Africa', d: ['Asia', 'Europe', 'South America'] },
  { q: 'How many edges does a cube have?', a: '12', d: ['8', '6', '10'] },
  { q: 'What color do you get by mixing blue and yellow?', a: 'Green', d: ['Purple', 'Orange', 'Brown'] },
  { q: 'Which metal is liquid at room temperature?', a: 'Mercury', d: ['Lead', 'Tin', 'Zinc'] },
  { q: 'How many days are in a leap year?', a: '366', d: ['365', '364', '360'] },
  { q: 'What is the largest planet in our solar system?', a: 'Jupiter', d: ['Saturn', 'Neptune', 'Earth'] },
  { q: 'Which direction does the sun rise from?', a: 'East', d: ['West', 'North', 'South'] },
];

const READING: { passage: string; q: string; a: string; d: string[] }[] = [
  {
    passage: 'The night shift starts at 22:00. Mara clocks in ten minutes early, checks the forklift batteries, then unlocks bay four before the first truck arrives at 22:30.',
    q: 'What does Mara do right after clocking in?',
    a: 'Checks the forklift batteries',
    d: ['Unlocks bay four', 'Meets the first truck', 'Starts the night shift'],
  },
  {
    passage: 'Three crews share the yard. Crew A paints, Crew B welds, and Crew C hauls scrap. On rainy days the painters swap with the haulers because paint will not dry.',
    q: 'Who welds on a rainy day?',
    a: 'Crew B',
    d: ['Crew A', 'Crew C', 'Nobody'],
  },
  {
    passage: 'The radio tower blinks twice every four seconds. When the backup generator is running, it blinks only once. Tonight it blinked once.',
    q: 'What does the single blink tell you?',
    a: 'The backup generator is running',
    d: ['The tower is off', 'It is raining', 'The crew went home'],
  },
  {
    passage: 'Jun left the garage with a full tank. He drove 40 km to the depot, 25 km to the docks, and then back to the depot before the fuel light came on.',
    q: 'Where was Jun when the fuel light came on?',
    a: 'The depot',
    d: ['The docks', 'The garage', 'On the highway'],
  },
  {
    passage: 'Lockers 1 to 10 are blue. Lockers 11 to 20 are grey. Every even-numbered grey locker has a padlock.',
    q: 'Does locker 15 have a padlock?',
    a: 'No',
    d: ['Yes', 'Only at night', 'It is blue'],
  },
  {
    passage: 'The freight elevator holds 800 kg. A pallet of bricks weighs 450 kg and a pallet of tiles weighs 300 kg.',
    q: 'Can one trip carry two pallets of bricks?',
    a: 'No',
    d: ['Yes', 'Only with tiles', 'Only empty'],
  },
];

const DIRS = ['North', 'East', 'South', 'West'] as const;
const SYMBOLS = ['▲', '●', '■', '◆'];

export const TASK_GENERATORS: Record<TaskKind, (rng: Rng) => Task> = {
  math(rng) {
    const kind = rng.int(0, 3);
    if (kind === 0) {
      const a = rng.int(12, 49), b = rng.int(3, 9);
      return { kind: 'math', prompt: `${a} × ${b} = ?`, input: 'number', answer: String(a * b), evaluation: 'numeric' };
    }
    if (kind === 1) {
      const b = rng.int(3, 12), q = rng.int(4, 15), c = rng.int(2, 30);
      return { kind: 'math', prompt: `${b * q} ÷ ${b} + ${c} = ?`, input: 'number', answer: String(q + c), evaluation: 'numeric' };
    }
    if (kind === 2) {
      const a = rng.int(120, 480), b = rng.int(30, 110);
      return { kind: 'math', prompt: `${a} − ${b} = ?`, input: 'number', answer: String(a - b), evaluation: 'numeric' };
    }
    const a = rng.int(2, 9), b = rng.int(2, 9), c = rng.int(1, 20);
    return { kind: 'math', prompt: `(${a} × ${b}) − ${c} = ?`, input: 'number', answer: String(a * b - c), evaluation: 'numeric' };
  },
  wordplay(rng) {
    const w = pick(rng, WORDS);
    if (rng.int(0, 1) === 0) {
      let scrambled = w;
      for (let i = 0; i < 6 && scrambled === w; i++) scrambled = shuffle(rng, w.split('')).join('');
      return { kind: 'wordplay', prompt: 'Unscramble this word.', detail: scrambled, input: 'text', answer: w, evaluation: 'normalized-text' };
    }
    return { kind: 'wordplay', prompt: 'Type this word backwards.', detail: w, input: 'text', answer: w.split('').reverse().join(''), evaluation: 'normalized-text' };
  },
  reading(rng) {
    const r = pick(rng, READING);
    return { kind: 'reading', prompt: r.q, detail: r.passage, input: 'choice', options: withOptions(rng, r.a, r.d), answer: r.a, evaluation: 'exact-choice' };
  },
  observation(rng) {
    const len = rng.int(14, 20);
    const strip = Array.from({ length: len }, () => SYMBOLS[rng.int(0, SYMBOLS.length - 1)]);
    const target = pick(rng, SYMBOLS);
    if (!strip.includes(target)) strip[rng.int(0, len - 1)] = target;
    const count = strip.filter((x) => x === target).length;
    return { kind: 'observation', prompt: `How many ${target} are in the strip?`, detail: strip.join(' '), input: 'number', answer: String(count), evaluation: 'numeric' };
  },
  knowledge(rng) {
    const k = pick(rng, KNOWLEDGE);
    return { kind: 'knowledge', prompt: k.q, input: 'choice', options: withOptions(rng, k.a, k.d), answer: k.a, evaluation: 'exact-choice' };
  },
  navigation(rng) {
    let facing = rng.int(0, 3);
    const start = DIRS[facing];
    const turns: string[] = [];
    for (let i = 0, n = rng.int(3, 5); i < n; i++) {
      const t = rng.int(0, 2);
      if (t === 0) { turns.push('right'); facing = (facing + 1) % 4; }
      else if (t === 1) { turns.push('left'); facing = (facing + 3) % 4; }
      else { turns.push('around'); facing = (facing + 2) % 4; }
    }
    return {
      kind: 'navigation',
      prompt: `You face ${start}. Turn ${turns.join(', then ')}. Which way are you facing?`,
      input: 'choice',
      options: [...DIRS],
      answer: DIRS[facing],
      evaluation: 'exact-choice',
    };
  },
  research(rng) {
    const ids = shuffle(rng, ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']).slice(0, 5);
    const weights = shuffle(rng, [180, 240, 310, 365, 420, 455, 510, 580]).slice(0, 5);
    const bays = ids.map(() => String(rng.int(1, 9)));
    const rows = ids.map((id, i) => [id, `Bay ${bays[i]}`, `${weights[i]} kg`]);
    if (rng.int(0, 1) === 0) {
      const heaviest = ids[weights.indexOf(Math.max(...weights))];
      return {
        kind: 'research',
        prompt: 'Which crate is the heaviest?',
        detail: { columns: ['Crate', 'Bay', 'Weight'], rows },
        input: 'choice',
        options: ids.slice().sort(),
        answer: heaviest,
        evaluation: 'exact-choice',
      };
    }
    const i = rng.int(0, ids.length - 1);
    return {
      kind: 'research',
      prompt: `Which bay number holds crate ${ids[i]}?`,
      detail: { columns: ['Crate', 'Bay', 'Weight'], rows },
      input: 'number',
      answer: bays[i],
      evaluation: 'numeric',
    };
  },
};

export const TASK_KINDS = Object.keys(TASK_GENERATORS) as TaskKind[];

export function generateTask(rng: Rng, avoid?: TaskKind): Task {
  const kinds = TASK_KINDS.filter((k) => k !== avoid);
  return TASK_GENERATORS[pick(rng, kinds)](rng);
}
