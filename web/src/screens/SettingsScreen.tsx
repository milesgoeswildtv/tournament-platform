import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, get, patch, post, setSession, updateUser, useSession, type User } from '../lib/api';
import { useLoad } from '../lib/useLoad';
import { setPrefs, usePrefs } from '../lib/prefs';
import { audio } from '../lib/audio';
import { navigate, useLocation } from '../lib/router';
import { DISCORD_RESULT, startDiscord } from '../lib/discord';
import { toast } from '../lib/toast';
import { openTelegram, reserveTab } from '../lib/telegram';
import { Button, Field, Segmented, TextInput, Toggle, fieldStyles } from '../ui/controls';
import { Chip, Page, PageHead, Section, Spec, Stack, Text } from '../ui/layout';
import sc from './screens.module.css';

export function SettingsScreen() {
  const session = useSession();
  const prefs = usePrefs();
  const me = useLoad(() => get<{ telegram: { configured: boolean; bot: string | null; linked: boolean; username: string | null }; discord: { configured: boolean; linked: boolean; username: string | null }; password: { configured: boolean; handle: string | null } }>('/api/me'));
  const { search } = useLocation();
  const discordNote = DISCORD_RESULT[search.get('discord') ?? ''];
  useEffect(() => {
    if (!discordNote) return;
    toast(discordNote.text, discordNote.tone);
    navigate('/settings', { replace: true });
  }, [discordNote]);
  const [dBusy, setDBusy] = useState(false);
  const [linking, setLinking] = useState(false);
  const [name, setName] = useState(session?.user.name ?? '');
  const [loginHandle, setLoginHandle] = useState(session?.user.handle ?? '');
  const [loginPassword, setLoginPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [adminBusy, setAdminBusy] = useState(false);
  const [issuerSecret, setIssuerSecret] = useState('');
  const [issueBusy, setIssueBusy] = useState(false);
  const [issuedKey, setIssuedKey] = useState('');
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

  const redeemAdminKey = async (e: FormEvent) => {
    e.preventDefault();
    setAdminBusy(true);
    try {
      const r = await post<{ ok: boolean; user: User }>('/api/me/admin/redeem', { key: adminKey });
      updateUser(r.user);
      setAdminKey('');
      await me.reload();
      toast('SHYST admin access activated.', 'good');
    } catch (e2) {
      toast((e2 as ApiError).message, 'error');
    } finally {
      setAdminBusy(false);
    }
  };

  const issueAdminKey = async (e: FormEvent) => {
    e.preventDefault();
    setIssueBusy(true);
    try {
      const r = await post<{ key: string }>('/api/admin/keys', { issuerSecret });
      setIssuedKey(r.key);
      setIssuerSecret('');
      toast('SHYST admin key created. Copy it now; it is shown only once.', 'good');
    } catch (e2) {
      toast((e2 as ApiError).message, 'error');
    } finally {
      setIssueBusy(false);
    }
  };

  const signOut = async () => {
    await post('/api/auth/logout').catch(() => {});
    setSession(null);
    navigate('/auth', { replace: true });
  };

  const tg = me.data?.telegram;
  const passwordConfigured = me.data?.password?.configured ?? !!session.user.handle;
  const savePasswordLogin = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordBusy(true);
    try {
      const r = await post<{ user: User }>('/api/me/password', {
        handle: loginHandle,
        password: loginPassword,
        ...(passwordConfigured ? { currentPassword } : {}),
      });
      updateUser(r.user);
      setLoginPassword('');
      setCurrentPassword('');
      await me.reload();
      toast('Username and password sign-in saved for this SHYST player.', 'good');
    } catch (e2) {
      toast((e2 as ApiError).message, 'error');
    } finally {
      setPasswordBusy(false);
    }
  };
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

      <Section title="Discord">
        {me.data?.discord ? (
          <Stack gap={2}>
            <Chip tone={me.data.discord.linked ? 'go' : me.data.discord.configured ? 'info' : 'muted'}>
              {me.data.discord.linked ? 'Linked' : me.data.discord.configured ? 'Not linked' : 'Not set up on this server'}
            </Chip>
            <Text tone="dust">
              {me.data.discord.linked
                ? `${me.data.discord.username ? `@${me.data.discord.username}` : 'Your Discord account'} signs in as this player, #${session.user.tag}.`
                : me.data.discord.configured
                  ? `Link Discord to sign in with it as this same player, #${session.user.tag}. Nothing about your history changes.`
                  : 'The operator hasn’t connected a Discord app yet.'}
            </Text>
            {me.data.discord.configured && !me.data.discord.linked && (
              <Button
                icon="discord"
                busy={dBusy}
                onClick={async () => {
                  setDBusy(true);
                  try {
                    const r = await startDiscord('link', '/settings');
                    if (r.linked) await me.reload();
                  } catch (e2) {
                    toast((e2 as ApiError).message, 'error');
                  } finally {
                    setDBusy(false);
                  }
                }}
              >
                Link Discord
              </Button>
            )}
          </Stack>
        ) : null}
      </Section>

      <Section title="Username and password">
        <Text tone="dust">
          {passwordConfigured
            ? 'This player already has a username and password. Changing either keeps the same player ID, history and tournament records.'
            : 'Add a username and password so you can sign in to this same player from any browser or device.'}
        </Text>
        <form onSubmit={savePasswordLogin} className={sc.form}>
          <TextInput
            label="Username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={loginHandle}
            onChange={(e) => setLoginHandle(e.target.value.toLowerCase())}
            hint="3–20 letters, numbers or underscores."
          />
          {passwordConfigured && (
            <TextInput label="Current password" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          )}
          <TextInput
            label={passwordConfigured ? 'New password' : 'Password'}
            type="password"
            autoComplete="new-password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            hint="At least 8 characters."
          />
          <div>
            <Button type="submit" variant="secondary" busy={passwordBusy} disabled={!loginHandle.trim() || loginPassword.length < 8 || (passwordConfigured && !currentPassword)}>
              {passwordConfigured ? 'Update login' : 'Create username and password'}
            </Button>
          </div>
        </form>
      </Section>

      <Section title="Issue SHYST admin key">
        <Text tone="dust">Owner-only. Enter the SHYST key-issuer secret configured on the Worker. The generated key is shown once and expires after 90 days.</Text>
        <form onSubmit={issueAdminKey} className={sc.form}>
          <TextInput label="Issuer secret" type="password" value={issuerSecret} onChange={(e) => setIssuerSecret(e.target.value)} autoComplete="off" />
          <div><Button type="submit" variant="secondary" busy={issueBusy} disabled={!issuerSecret}>Generate SHYST Admin Key</Button></div>
        </form>
        {issuedKey && <Stack gap={2}><Text tone="go">Copy this key now. It cannot be displayed again.</Text><Text>{issuedKey}</Text><Button variant="ghost" onClick={() => navigator.clipboard?.writeText(issuedKey)}>Copy key</Button></Stack>}
      </Section>

      {!session.user.isAdmin && (
        <Section title="Redeem admin key">
          <Text tone="dust">Enter a SHYST Admin Key. It grants admin access to this SHYST account only; keys are issued independently by SHYST.</Text>
          <form onSubmit={redeemAdminKey} className={sc.form}>
            <TextInput label="SHYST Admin Key" value={adminKey} onChange={(e) => setAdminKey(e.target.value.toUpperCase())} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
            <div><Button type="submit" variant="secondary" busy={adminBusy} disabled={adminKey.trim().length < 12}>Redeem Code</Button></div>
          </form>
        </Section>
      )}

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
