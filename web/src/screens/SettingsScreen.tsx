import { useState, type FormEvent } from 'react';
import { ApiError, get, patch, post, setSession, updateUser, useSession, type User } from '../lib/api';
import { useLoad } from '../lib/useLoad';
import { setPrefs, usePrefs } from '../lib/prefs';
import { audio } from '../lib/audio';
import { navigate } from '../lib/router';
import { toast } from '../lib/toast';
import { openTelegram, reserveTab } from '../lib/telegram';
import { Button, Field, Segmented, TextInput, Toggle, fieldStyles } from '../ui/controls';
import { Chip, Page, PageHead, Section, Spec, Stack, Text } from '../ui/layout';
import sc from './screens.module.css';

export function SettingsScreen() {
  const session = useSession();
  const prefs = usePrefs();
  const me = useLoad(() => get<{ telegram: { configured: boolean; bot: string | null; linked: boolean; username: string | null } }>('/api/me'));
  const [linking, setLinking] = useState(false);
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
        <form onSubmit={save} className={sc.form}>
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
          <Stack gap={2}>
            <Chip tone={tg.linked ? 'go' : tg.configured ? 'info' : 'muted'}>{tg.linked ? 'Linked' : tg.configured ? 'Not linked' : 'Not set up on this server'}</Chip>
            <Text tone="dust">
              {tg.linked
                ? `${tg.username ? `@${tg.username}` : 'Your Telegram account'} signs in as this player, #${session.user.tag}. Countdown alerts and results also arrive from the bot.`
                : tg.configured
                  ? `Link Telegram to sign in from the bot as this same player, #${session.user.tag}. Your history and tournaments stay on this one player.`
                  : 'The operator hasn’t connected a Telegram bot yet. Everything works in the browser.'}
            </Text>
            {tg.configured && tg.bot && !tg.linked && (
              <Button
                icon="telegram"
                busy={linking}
                onClick={async () => {
                  setLinking(true);
                  const tab = reserveTab();
                  try {
                    const r = await post<{ linked: boolean; botUrl?: string }>('/api/me/telegram/link');
                    if (r.linked || !r.botUrl) {
                      tab?.close();
                      await me.reload();
                    } else {
                      openTelegram(r.botUrl, tab);
                      toast('Telegram is open. Tap Start in the bot chat to finish linking.', 'good');
                    }
                  } catch (e2) {
                    tab?.close();
                    toast((e2 as ApiError).message, 'error');
                  } finally {
                    setLinking(false);
                  }
                }}
              >
                Link Telegram
              </Button>
            )}
            {tg.configured && !tg.linked && (
              <Button variant="ghost" size="sm" icon="refresh" onClick={() => me.reload()}>
                I tapped Start, check again
              </Button>
            )}
          </Stack>
        ) : null}
      </Section>

      <Section title="Account">
        <Stack gap={2}>
          {session.user.isAdmin && (
            <Button to="/admin" icon="log">
              Admin: all tournaments
            </Button>
          )}
          <Button variant="danger" icon="exit" onClick={signOut}>
            Sign out
          </Button>
        </Stack>
      </Section>
    </Page>
  );
}
