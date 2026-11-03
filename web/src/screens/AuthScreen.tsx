import { useState, type FormEvent } from 'react';
import { ApiError, post, setSession, useSession, type User } from '../lib/api';
import { navigate, useLocation } from '../lib/router';
import { Button, Segmented, TextInput } from '../ui/controls';
import { Text } from '../ui/layout';
import { TapeMark } from '../ui/venue';
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
      navigate(next, { replace: true });
    } catch (e2) {
      const a = e2 as ApiError;
      setErr({ field: a.details?.field, message: a.message });
    } finally {
      setBusy(false);
    }
  };

  const fieldErr = (f: string) => (err && err.field === f ? err.message : null);

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
        <p className={s.authFoot}>Prize amounts are sponsor commitments recorded by the platform. No money moves through this app.</p>
      </form>
    </main>
  );
}
