import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RoomView } from '@shared/client';
import { LIMITS } from '@shared/client';
import { Button, TextInput } from '../../ui/controls';
import { clockTime } from '../../lib/format';
import s from './room.module.css';

export function ChatPanel({ view, onSend }: { view: RoomView; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const myId = view.me?.id;
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [view.chat.length]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };
  const canChat = !!view.me && !view.me.left;
  return (
    <div className={s.chat}>
      <div className={s.msgs} ref={box} aria-live="polite">
        {view.chat.length === 0 && <p className={s.sys}>No messages yet. Say something.</p>}
        {view.chat.map((m) =>
          m.system ? (
            <p key={m.id} className={s.sys}>
              {m.text}
            </p>
          ) : (
            <div key={m.id} className={s.msg} data-me={m.playerId === myId}>
              <b>
                {m.name} <span style={{ color: 'var(--ash)', fontWeight: 600 }}>{clockTime(m.at)}</span>
              </b>
              <p>{m.text}</p>
            </div>
          ),
        )}
      </div>
      {canChat && (
        <form className={s.compose} onSubmit={submit}>
          <TextInput aria-label="Message" placeholder="Message the room" value={text} maxLength={LIMITS.chatMax} onChange={(e) => setText(e.target.value)} enterKeyHint="send" />
          <Button type="submit" variant="secondary" disabled={!text.trim()}>
            Send
          </Button>
        </form>
      )}
    </div>
  );
}
