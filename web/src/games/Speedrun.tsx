import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, TextInput } from '../ui/controls';
import { Chip } from '../ui/layout';
import { Icon } from '../ui/Icon';
import { Spectating } from './common';
import type { PlayProps, RevealProps } from './types';
import s from './games.module.css';

const KIND: Record<string, string> = {
  math: 'Math',
  wordplay: 'Wordplay',
  reading: 'Reading',
  observation: 'Observation',
  knowledge: 'General knowledge',
  navigation: 'Directions',
  research: 'Look it up',
};

interface TaskView {
  kind: string;
  prompt: string;
  detail?: string | { columns: string[]; rows: string[][] };
  input: 'number' | 'text' | 'choice';
  options?: string[];
}

function Detail({ d, kind }: { d: TaskView['detail']; kind: string }) {
  if (!d) return null;
  if (typeof d === 'string') return <div className={`${s.taskDetail} ${kind === 'observation' ? s.symbols : ''}`}>{d}</div>;
  return (
    <div className={s.taskDetail}>
      <table>
        <thead>
          <tr>
            {d.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stopwatch({ from, serverNow, stopAt }: { from: number; serverNow: () => number; stopAt?: number | null }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const t = Math.max(0, (stopAt ?? serverNow()) - from) / 1000;
      if (el.current) el.current.textContent = `${t.toFixed(1)}s`;
      if (!stopAt) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [from, serverNow, stopAt]);
  return <span ref={el} className={s.clock} />;
}

export function SpeedrunPlay({ pub, mine, me, canAct, pending, act, stage, serverNow }: PlayProps) {
  const task = pub?.task as TaskView | undefined;
  const [answer, setAnswer] = useState('');
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const locked: string | null = mine?.answer ?? null;
  useEffect(() => {
    setAnswer('');
    setStoppedAt(null);
  }, [stage.round]);
  const send = (v: string) => {
    if (!v.trim()) return;
    setStoppedAt(serverNow());
    act({ answer: v.trim() });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(answer);
  };
  if (!task) return null;
  return (
    <div className={s.play}>
      <div className={s.task}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Chip tone="info">{KIND[task.kind] ?? task.kind}</Chip>
          <Stopwatch from={stage.roundStartedAt} serverNow={serverNow} stopAt={locked ? (stoppedAt ?? serverNow()) : null} />
        </div>
        <p className={s.taskPrompt}>{task.prompt}</p>
        <Detail d={task.detail} kind={task.kind} />
      </div>
      <div className={s.grow} style={{ justifyContent: 'flex-end' }}>
        {locked ? (
          <div className={s.locked} role="status">
            <Icon name="lock" size={20} />
            <span>Answer locked: “{locked}”</span>
          </div>
        ) : !canAct ? (
          <Spectating me={me} />
        ) : task.input === 'choice' ? (
          <div className={s.choices} role="group" aria-label="Answers">
            {(task.options ?? []).map((o) => (
              <button key={o} type="button" className={s.choice} disabled={pending} onClick={() => send(o)}>
                {o}
              </button>
            ))}
          </div>
        ) : (
          <form className={s.guessRow} onSubmit={submit}>
            <TextInput
              aria-label="Your answer"
              placeholder={task.input === 'number' ? 'Number' : 'Answer'}
              inputMode={task.input === 'number' ? 'decimal' : 'text'}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={answer}
              maxLength={80}
              onChange={(e) => setAnswer(e.target.value)}
            />
            <Button type="submit" variant="primary" disabled={!answer.trim()} busy={pending}>
              Submit
            </Button>
          </form>
        )}
        <p className={s.small} style={{ textAlign: 'center' }}>
          Wrong or no answer is out. Fast and right survives.
        </p>
      </div>
    </div>
  );
}

export function SpeedrunReveal({ reveal, myId, name }: RevealProps) {
  const r = reveal as { answer: string | null; quota: number; voided: boolean; answers: Record<string, { text: string; correct: boolean; ms: number } | null> };
  const rows = Object.entries(r.answers ?? {}).sort((a, b) => {
    const x = a[1], y = b[1];
    if (x?.correct && y?.correct) return x.ms - y.ms;
    return (y?.correct ? 1 : 0) - (x?.correct ? 1 : 0);
  });
  const mine = myId ? r.answers?.[myId] : undefined;
  return (
    <div className={s.reveal}>
      <div className={s.revealHead}>
        <p className={s.small}>Answer</p>
        <p className={s.big} style={{ color: '#6fa8ff' }}>{r.answer}</p>
        <p className={s.small}>{r.voided ? 'Nobody got it. The task is void and everyone stays in.' : `Cut quota this round: at least ${r.quota}.`}</p>
        {mine !== undefined && <p>{mine === null ? 'You didn’t answer.' : mine.correct ? `Correct in ${(mine.ms / 1000).toFixed(2)}s` : `“${mine.text}” was wrong`}</p>}
      </div>
      <div className={s.list}>
        {rows.map(([p, a]) => (
          <div className={s.listRow} key={p}>
            <b>{name(p)}</b>
            <span className={a?.correct ? s.ok : s.bad}>{a ? (a.correct ? `${(a.ms / 1000).toFixed(2)}s` : 'Wrong') : 'No answer'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
