import { useState, type FormEvent } from 'react';
import { Button, TextInput, vars } from '../ui/controls';
import { Spectating } from './common';
import { Icon } from '../ui/Icon';
import type { PlayProps, RevealProps } from './types';
import s from './games.module.css';

function Board({ text, open }: { text: string; open?: boolean }) {
  const words = text.split(' ');
  const longest = Math.max(...words.map((w) => w.length));
  return (
    <div className={s.board} style={vars({ '--n': Math.max(6, longest) })} aria-label={open ? text : `Hidden phrase: ${words.length} words`}>
      {words.map((w, i) => (
        <div className={s.word} key={i}>
          {w.split('').map((ch, j) => (
            <span key={j} className={`${s.tile} ${ch === '_' ? s.tileBlank : ''} ${open ? s.tileOpen : ''}`} style={open ? vars({ '--i': i * 4 + j }) : undefined}>
              {ch === '_' ? '' : ch}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function DecodePlay({ pub, mine, me, canAct, pending, act, stage }: PlayProps) {
  const [guess, setGuess] = useState('');
  const locked: string | null = mine?.guess ?? null;
  const history: string[] = (mine?.history ?? []).filter((g: string) => g !== locked);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (guess.trim()) act({ guess: guess.trim() });
  };
  return (
    <div className={s.play}>
      <div className={s.grow}>
        <p className={s.category}>
          <b>{pub?.category ?? 'Phrase'}</b>
          <span>First letters shown{stage.round >= 3 ? ', vowels open' : ''}</span>
        </p>
        {pub?.board && <Board text={pub.board} />}
        {pub?.clues?.length > 0 && (
          <ol className={s.clues}>
            {pub.clues.map((c: string, i: number) => (
              <li key={i}>
                <b>Clue {i + 1}</b>
                {c}
              </li>
            ))}
          </ol>
        )}
        {history.length > 0 && <p className={s.history}>Your earlier guesses: {history.join(', ')}</p>}
      </div>
      {locked ? (
        <div className={s.action}>
          <div className={s.locked} role="status">
            <Icon name="lock" size={20} />
            <span>Guess locked: “{locked}”</span>
          </div>
        </div>
      ) : canAct ? (
        <form className={`${s.action} ${s.guessRow}`} onSubmit={submit}>
          <TextInput aria-label="Your guess" placeholder="Type the phrase" value={guess} maxLength={80} autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} onChange={(e) => setGuess(e.target.value)} />
          <Button type="submit" variant="primary" disabled={!guess.trim()} busy={pending}>
            Guess
          </Button>
        </form>
      ) : (
        <div className={s.action}>
          <Spectating me={me} />
        </div>
      )}
    </div>
  );
}

export function DecodeReveal({ reveal, myId, name, stage }: RevealProps) {
  const r = reveal as { answer: string | null; solved: string[]; winner: string | null; wrong: number; guesses: Record<string, string | null> | null };
  const mine = myId && r.guesses ? r.guesses[myId] : null;
  return (
    <div className={s.reveal}>
      <div className={s.revealHead}>
        {r.answer ? <Board text={r.answer} open /> : <p className={s.big}>Not cracked yet</p>}
        {r.winner ? (
          <p>
            First to crack it: <b>{name(r.winner)}</b>
            {r.solved.length > 1 ? `, then ${r.solved.slice(1).map(name).join(', ')}` : ''}
          </p>
        ) : r.answer ? (
          <p>Nobody cracked it.</p>
        ) : (
          <p className={s.small}>
            {r.wrong} wrong guess{r.wrong === 1 ? '' : 'es'}. Round {stage.round + 1} adds {stage.round + 1 >= 3 ? 'a second clue and the vowels' : 'a clue'}.
          </p>
        )}
        {mine && <p className={s.small}>You guessed “{mine}”.</p>}
      </div>
    </div>
  );
}
