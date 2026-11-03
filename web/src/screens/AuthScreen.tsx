import { useState, type FormEvent } from 'react';
import { ApiError, post, setSession, useSession, type User } from '../lib/api';
import { navigate, useLocation } from '../lib/router';
import { Button, Segmented, TextInput } from '../ui/controls';
import { Note, Text } from '../ui/layout';
import { TapeMark } from '../ui/venue';
import { DISCORD_RESULT, completeDiscord, startDiscord } from '../lib/discord';
import { get } from '../lib/api';
import { useLoad } from '../lib/useLoad';
import { toast } from '../lib/toast';
import { inTelegram, linkInMiniApp } from '../lib/telegram';
import s from './screens.module.css';

export function AuthScreen() {
  const session = useSession();
  const { search } = useLocation();
  const next = search.get('next') || '/';
  const [mode, setMode] = useState<'signin' | 'signup'>(search.get('mode') === 'signup' ? 'signup' : 'signin');
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);
  const [discordBusy, setDiscordBusy] = useState(false);
  const providers = useLoad(() => get<{ discord: boolean; telegram: { enabled: boolean; bot: string | null } }>('/api/auth/providers'));

  if (session) {
    queueMicrotask(() => navigate(next, { replace: true }));
    return null;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r =
        mode === 'signup'
          ? await post<{ token: string; user: User }>('/api/auth/register', { handle, password, displayName: name || handle })
          : await post<{ token: string; user: User }>('/api/auth/login', { handle, password });
      setSession({ token: r.token, user: r.user });
      if (inTelegram()) await linkInMiniApp();
      // "I already play on SHYST" from the Discord return screen: attach that Discord identity now.
      const pending = search.get('discordPending');
      if (pending) {
        try {
          await completeDiscord(pending, 'link');
          toast('Discord linked. It now signs you in as this player.', 'good');
        } catch (e3) {
          toast((e3 as ApiError).message, 'error');
        }
      }
      navigate(next, { replace: true });
    } catch (e2) {
      const a = e2 as ApiError;
      setErr({ field: a.details?.field, message: a.message });
    } finally {
      setBusy(false);
    }
  };

  const fieldErr = (f: string) => (err && err.field === f ? err.message : null);
  const p = providers.data;
  const discordNote = DISCORD_RESULT[search.get('discord') ?? ''];
  const linkingDiscord = !!search.get('discordPending');

  return (
    <main className={s.auth}>
      <div className={s.authHero}>
        <h1 className={s.authMark}>
          <TapeMark size="xl" />
        </h1>
        <p className={s.authLede}>Sponsored elimination tournaments. Ten to twenty-five stages, one game each. Survive the stage, take the stage.</p>
        <ul className={s.authFacts} aria-label="How it works">
          <li>
            <b>Sponsors</b> put up the prizes and run the room.
          </li>
          <li>
            <b>Players</b> join with an invite and play every stage live.
          </li>
          <li>
            <b>The server</b> keeps the clock and calls every result.
          </li>
        </ul>
      </div>
      <form className={s.authForm} onSubmit={submit} noValidate>
        <Segmented
          label="Account"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setErr(null);
          }}
          options={[
            { value: 'signin', label: 'Sign in' },
            { value: 'signup', label: 'Create account' },
          ]}
        />
        <TextInput
          label="Username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={handle}
          onChange={(e) => setHandle(e.target.value.toLowerCase())}
          hint={mode === 'signup' ? '3–20 letters, numbers or underscores. This is how you sign in.' : undefined}
          error={fieldErr('handle')}
          required
        />
        {mode === 'signup' && (
          <TextInput label="Display name" autoComplete="nickname" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} hint="What other players see. You can change it later." error={fieldErr('displayName')} />
        )}
        <TextInput
          label="Password"
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
          error={fieldErr('password')}
          required
        />
        {err && !err.field && (
          <Text tone="stop" role="alert">
            {err.message}
          </Text>
        )}
        <Button type="submit" variant="primary" size="lg" block busy={busy} disabled={!handle || password.length < (mode === 'signup' ? 8 : 1)}>
          {mode === 'signup' ? 'Create account' : 'Sign in'}
        </Button>
        {linkingDiscord && <Note>Sign in to the SHYST player you already have. Your verified Discord account is attached to it as soon as you’re in.</Note>}
        {discordNote && <Text tone={discordNote.tone === 'good' ? 'go' : 'stop'} role="status">{discordNote.text}</Text>}
        {p && (p.discord || p.telegram.bot) && !linkingDiscord && (
          <div className={s.providers}>
            <span className={s.providersRule}>or</span>
            {p.discord && (
              <Button
                icon="discord"
                block
                busy={discordBusy}
                onClick={async () => {
                  setDiscordBusy(true);
                  try {
                    await startDiscord('login', next);
                  } catch (e2) {
                    toast((e2 as ApiError).message, 'error');
                    setDiscordBusy(false);
                  }
                }}
              >
                Continue with Discord
              </Button>
            )}
            {p.telegram.bot && !inTelegram() && (
              <Button icon="telegram" block onClick={() => window.open(`https://t.me/${p.telegram.bot}`, '_blank', 'noopener')}>
                Play in Telegram
              </Button>
            )}
            <Text tone="ash" size="sm">
              Discord and Telegram sign you in to one SHYST player. Already have one? Link them in Settings.
            </Text>
          </div>
        )}
        <p className={s.authFoot}>Prize amounts are sponsor commitments recorded by the platform. No money moves through this app.</p>
      </form>
    </main>
  );
}
