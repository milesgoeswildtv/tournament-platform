import { useState, type FormEvent } from 'react';
import { ApiError, get, patch, post, setSession, updateUser, useSession, type User } from '../lib/api';
import { useLoad } from '../lib/useLoad';
import { setPrefs, usePrefs } from '../lib/prefs';
import { audio } from '../lib/audio';
import { navigate } from '../lib/router';
import { toast } from '../lib/toast';
import { inTelegram } from '../lib/telegram';
import { Button, Field, Segmented, TextInput, Toggle, fieldStyles } from '../ui/controls';
import { Chip, Page, PageHead, Section, Spec } from '../ui/layout';

export function SettingsScreen() {
  const session = useSession();
  const prefs = usePrefs();
  const me = useLoad(() => get<{ telegram: { configured: boolean; bot: string | null; linked: boolean } }>('/api/me'));
  const [name, setName] = useState(session?.user.name ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!session) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await patch<{ user: User }>('/api/me', { displayName: name });
      updateUser(r.user);
      toast('Display name saved. New lobbies use it right away.', 'good');
    } catch (e2) {
      setErr((e2 as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await post('/api/auth/logout').catch(() => {});
    setSession(null);
    navigate('/auth', { replace: true });
  };

  const tg = me.data?.telegram;
  return (
    <Page>
      <PageHead title="Settings" />

      <Section title="Profile">
        <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
          <TextInput label="Display name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} error={err} hint="2–24 characters. Shown in lobbies, chat and results." />
          <div>
            <Button type="submit" variant="secondary" busy={busy} disabled={name.trim() === session.user.name || name.trim().length < 2}>
              Save name
            </Button>
          </div>
        </form>
        <Spec items={[['Player ID', `#${session.user.tag}`], ['Username', session.user.handle ?? 'Telegram account']]} />
      </Section>

      <Section title="Sound and feel">
        <Toggle
          checked={prefs.music}
          onChange={(v) => {
            setPrefs({ music: v });
            audio.syncMusic();
          }}
          label="Music"
          hint="A low loop generated on your device. Off by default."
        />
        <Field label={`Music volume ${Math.round(prefs.musicVolume * 100)}%`}>
          <input
            type="range"
            className={fieldStyles.range}
            min={0}
            max={1}
            step={0.05}
            value={prefs.musicVolume}
            disabled={!prefs.music}
            onChange={(e) => {
              const v = Number(e.target.value);
              setPrefs({ musicVolume: v });
              audio.setMusicVolume(v);
            }}
          />
        </Field>
        <Toggle checked={prefs.sfx} onChange={(v) => setPrefs({ sfx: v })} label="Game sounds" hint="Ticks, lock-ins and reveals." />
        <Toggle checked={prefs.haptics} onChange={(v) => setPrefs({ haptics: v })} label="Vibration" hint="On phones that support it, and inside Telegram." />
        <Field label="Motion">
          <Segmented
            label="Motion"
            value={prefs.motion}
            onChange={(v) => setPrefs({ motion: v })}
            options={[
              { value: 'system', label: 'Follow device' },
              { value: 'reduced', label: 'Reduce motion' },
            ]}
          />
        </Field>
      </Section>

      <Section title="Telegram">
        {tg ? (
          <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
            <Chip tone={tg.linked ? 'go' : tg.configured ? 'info' : 'muted'}>{tg.linked ? 'Linked' : tg.configured ? 'Not linked' : 'Not set up on this server'}</Chip>
            <p style={{ color: 'var(--dust)' }}>
              {tg.linked
                ? 'Countdown alerts and results also arrive from the bot.'
                : tg.configured
                  ? `Open the app from ${tg.bot ? `@${tg.bot}` : 'the bot'} in Telegram while signed in here to link your account.`
                  : 'The operator hasn’t connected a Telegram bot yet. Everything works in the browser.'}
            </p>
            {tg.configured && tg.bot && !tg.linked && !inTelegram() && (
              <Button icon="telegram" onClick={() => window.open(`https://t.me/${tg.bot}?start=link`, '_blank', 'noopener')}>
                Open the bot
              </Button>
            )}
          </div>
        ) : null}
      </Section>

      <Section title="Account">
        <div style={{ display: 'grid', gap: 8 }}>
          {session.user.isAdmin && <Button to="/admin" icon="log">Admin: all tournaments</Button>}
          <Button variant="danger" icon="exit" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Section>
    </Page>
  );
}
