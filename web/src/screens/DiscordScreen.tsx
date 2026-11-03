import { useEffect, useState } from 'react';
import { ApiError, setSession, useSession } from '../lib/api';
import { navigate } from '../lib/router';
import { completeDiscord, exchangeDiscordTicket } from '../lib/discord';
import { toast } from '../lib/toast';
import { Button } from '../ui/controls';
import { Loading, Note, StatusScreen, Text } from '../ui/layout';
import { TapeMark } from '../ui/venue';

/**
 * Where Discord's OAuth callback lands. The fragment carries either a one-time
 * ticket (a known Discord account → sign in) or a pending identity (no SHYST
 * player yet → the person chooses). Fragments never reach any server log.
 */
export function DiscordScreen() {
  const session = useSession();
  const [h] = useState(() => new URLSearchParams(window.location.hash.slice(1)));
  const ticket = h.get('ticket');
  const pending = h.get('pending');
  const name = h.get('name') ?? 'your Discord account';
  const next = h.get('next') && h.get('next')!.startsWith('/') && !h.get('next')!.startsWith('//') ? h.get('next')! : '/';
  const [busy, setBusy] = useState<null | 'create' | 'link'>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Drop the one-time values from the address bar and history.
    window.history.replaceState(null, '', '/auth/discord');
    if (!ticket) return;
    exchangeDiscordTicket(ticket)
      .then((r) => {
        setSession({ token: r.token, user: r.user });
        navigate(next, { replace: true });
      })
      .catch((e) => setErr((e as ApiError).message));
  }, [ticket, next]);

  if (ticket && !err) return <Loading label="Signing in with Discord" />;
  if (!pending || err) {
    return (
      <StatusScreen title="Discord sign-in" actions={<Button to="/auth" variant="primary" block>Back to sign in</Button>}>
        <Text tone="dust">{err ?? 'This Discord sign-in link has already been used or has expired.'}</Text>
      </StatusScreen>
    );
  }

  const act = async (action: 'create' | 'link') => {
    setBusy(action);
    try {
      const r = await completeDiscord(pending, action);
      if (r.token) setSession({ token: r.token, user: r.user });
      toast(action === 'link' ? 'Discord linked. It now signs you in as this player.' : `Welcome to SHYST, ${r.user.name}.`, 'good');
      navigate(action === 'link' ? '/settings' : next, { replace: true });
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(null);
    }
  };

  return (
    <StatusScreen
      chip={<TapeMark />}
      title="Discord verified"
      actions={
        <>
          {session ? (
            <Button variant="primary" size="lg" block busy={busy === 'link'} onClick={() => act('link')}>
              Link to {session.user.name} (#{session.user.tag})
            </Button>
          ) : (
            <Button variant="primary" size="lg" block busy={busy === 'create'} onClick={() => act('create')}>
              Create my SHYST player
            </Button>
          )}
          {!session && (
            <Button block onClick={() => navigate(`/auth?discordPending=${encodeURIComponent(pending)}&next=${encodeURIComponent('/settings')}`)}>
              I already play on SHYST
            </Button>
          )}
          <Button variant="ghost" block to="/auth">
            Cancel
          </Button>
        </>
      }
    >
      <Text tone="dust">
        Signed in to Discord as <b>{name}</b>. No SHYST player uses this Discord account yet.
      </Text>
      <Note>
        One person, one SHYST player. If you already play (with a username or in Telegram), link Discord to that player instead of creating a second one. Signed up in Telegram? Open SHYST there, go to Settings and tap Link Discord.
      </Note>
    </StatusScreen>
  );
}
