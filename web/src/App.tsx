import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RouterProvider, match, navigate, useLocation } from './lib/router';
import { get, post, setSession, useSession, updateUser, type ApiError } from './lib/api';
import { bootTelegram, inTelegram } from './lib/telegram';
import { AppShell, OfflineBanner, Toasts } from './ui/shell';
import { Loading } from './ui/layout';
import { music } from './lib/music';
import { toast } from './lib/toast';
import { AuthScreen } from './screens/AuthScreen';
import { DiscordScreen } from './screens/DiscordScreen';
import { HubScreen } from './screens/HubScreen';
import { JoinScreen, InviteScreen } from './screens/JoinScreen';
import { SponsorScreen } from './screens/SponsorScreen';
import { CreateScreen } from './screens/CreateScreen';
import { LibraryScreen, GameDetailScreen } from './screens/LibraryScreen';
import { RanksScreen } from './screens/RanksScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { RoomScreen } from './screens/RoomScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { AuditScreen } from './screens/AuditScreen';
import { AdminScreen } from './screens/AdminScreen';
import { BotLabScreen } from './screens/BotLabScreen';
import { NotFound } from './screens/NotFound';

type R = { pattern: string; render: (p: Record<string, string>) => ReactNode; shell?: boolean; public?: boolean };

const ROUTES: R[] = [
  { pattern: '/', render: () => <HubScreen />, shell: true },
  { pattern: '/auth', render: () => <AuthScreen />, public: true },
  { pattern: '/auth/discord', render: () => <DiscordScreen />, public: true },
  { pattern: '/connect/crashout', render: () => <CrashoutLinkChoice />, public: true },
  { pattern: '/join', render: () => <JoinScreen />, shell: true },
  { pattern: '/j/:code', render: (p) => <InviteScreen code={p.code} />, shell: true, public: true },
  { pattern: '/sponsor', render: () => <SponsorScreen />, shell: true },
  { pattern: '/sponsor/new', render: () => <CreateScreen />, shell: true },
  { pattern: '/t/:id/edit', render: (p) => <CreateScreen editId={p.id} />, shell: true },
  { pattern: '/t/:id', render: (p) => <RoomScreen id={p.id} /> },
  { pattern: '/t/:id/results', render: (p) => <ResultsScreen id={p.id} />, shell: true },
  { pattern: '/t/:id/audit', render: (p) => <AuditScreen id={p.id} />, shell: true },
  { pattern: '/games', render: () => <LibraryScreen />, shell: true },
  { pattern: '/games/:id', render: (p) => <GameDetailScreen id={p.id} />, shell: true },
  { pattern: '/ranks', render: () => <RanksScreen />, shell: true },
  { pattern: '/me', render: () => <ProfileScreen />, shell: true },
  { pattern: '/p/:tag', render: (p) => <ProfileScreen tag={p.tag} />, shell: true },
  { pattern: '/settings', render: () => <SettingsScreen />, shell: true },
  { pattern: '/admin', render: () => <AdminScreen />, shell: true },
  { pattern: '/admin/bots', render: () => <BotLabScreen />, shell: true },
];

function useUnread(signedIn: boolean, path: string) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    const load = () =>
      get<{ unread: number; user: any }>('/api/me')
        .then((r) => {
          if (!live) return;
          setUnread(r.unread);
          updateUser(r.user);
        })
        .catch(() => {});
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [signedIn, path]);
  return unread;
}

function CrashoutLinkChoice() {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const token = (() => { try { return sessionStorage.getItem('crashout.link.token') ?? ''; } catch { return ''; } })();
  const flow = (() => { try { return sessionStorage.getItem('crashout.link.flow') ?? 'existing'; } catch { return 'existing'; } })();

  async function useCurrentAccount() {
    if (!token) { setError('The Crashout link has expired. Start again from the Crashout hub.'); return; }
    setBusy(true); setError('');
    try {
      await post('/api/me/crashout/link', { token });
      try {
        sessionStorage.removeItem('crashout.link.token');
        sessionStorage.removeItem('crashout.link.flow');
        sessionStorage.removeItem('crashout.link.authConfirmed');
      } catch { /* ignore */ }
      toast('Your current SHYST account is now connected to Crashout.', 'good');
      navigate('/', { replace: true });
    } catch (e) {
      setError((e as ApiError).message || 'Could not connect this SHYST account.');
    } finally { setBusy(false); }
  }

  async function switchAccount() {
    setBusy(true); setError('');
    try {
      await post('/api/auth/logout');
      try { sessionStorage.setItem('crashout.link.authConfirmed', '1'); } catch { /* ignore */ }
      setSession(null);
      navigate(flow === 'create' ? '/auth?mode=signup&next=%2F' : '/auth?next=%2F', { replace: true });
    } catch (e) {
      setError((e as ApiError).message || 'Could not safely sign out. Try again.');
    } finally { setBusy(false); }
  }

  if (!session) {
    queueMicrotask(() => navigate(flow === 'create' ? '/auth?mode=signup&next=%2F' : '/auth?next=%2F', { replace: true }));
    return <Loading />;
  }

  return (
    <main className="social-page">
      <div className="eyebrow">CRASHOUT CONNECTION / ACCOUNT SELECTION</div>
      <h1>ALREADY <em>SIGNED IN.</em></h1>
      <p className="social-lead">
        SHYST is currently signed in as <b>{session.user.name}</b> (Player #{session.user.tag}).
        {flow === 'create' ? ' You chose to create a new SHYST account from Crashout.' : ' You chose to link an existing SHYST account from Crashout.'}
        {' '}Choose whether to connect this current player or sign out and use a different SHYST account. Nothing is merged.
      </p>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <div className="settings-card">
        <button className="primary" disabled={busy || !token} onClick={() => void useCurrentAccount()}>
          {busy ? 'WORKING...' : 'USE THIS SHYST ACCOUNT'}
        </button>
        <button className="social-action" disabled={busy} onClick={() => void switchAccount()}>
          {flow === 'create' ? 'SIGN OUT & CREATE A NEW ACCOUNT' : 'SIGN OUT & CHOOSE ANOTHER ACCOUNT'}
        </button>
      </div>
    </main>
  );
}

function Routes() {
  const session = useSession();
  const { path } = useLocation();
  const [booting, setBooting] = useState(inTelegram());
  const unread = useUnread(!!session, path);
  const linkInFlight = useRef<string | null>(null);

  // The one-time token is carried in the URL fragment so it is never sent to
  // the SHYST web server or included in HTTP referrers. Move it to tab-scoped
  // storage before the protected-route redirect can replace the URL.
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const incomingLinkToken = fragment.get('crashout_link');
  if (incomingLinkToken && /^[a-f0-9]{64}$/.test(incomingLinkToken)) {
    try {
      sessionStorage.setItem('crashout.link.token', incomingLinkToken);
      sessionStorage.setItem('crashout.link.flow', fragment.get('crashout_flow') === 'create' ? 'create' : 'existing');
    } catch {
      // If tab storage is unavailable, the user can restart linking from Crashout.
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  useEffect(() => {
    if (!session) return;
    let token = '';
    try { token = sessionStorage.getItem('crashout.link.token') ?? ''; } catch { return; }
    if (!token) return;
    let authConfirmed = false;
    try {
      authConfirmed = sessionStorage.getItem('crashout.link.authConfirmed') === '1';
    } catch { /* ignore */ }
    if (!authConfirmed) {
      navigate('/connect/crashout', { replace: true });
      return;
    }
    if (linkInFlight.current === token) return;
    linkInFlight.current = token;
    post<{ ok: boolean; linked: boolean }>('/api/me/crashout/link', { token })
      .then(() => toast('Your SHYST account is now connected to Crashout.', 'good'))
      .catch((error) => toast((error as ApiError).message || 'Crashout could not complete the account link. Start again from the hub.', 'error'))
      .finally(() => {
        try {
          sessionStorage.removeItem('crashout.link.token');
          sessionStorage.removeItem('crashout.link.flow');
          sessionStorage.removeItem('crashout.link.authConfirmed');
        } catch { /* tab storage may be unavailable */ }
        linkInFlight.current = null;
      });
  }, [session?.user.id]);

  useEffect(() => {
    if (!path.startsWith('/t/') || path.slice(3).includes('/')) music.setScreen('lobby');
  }, [path]);

  useEffect(() => {
    if (!booting) return;
    bootTelegram(!!session).then((start) => {
      setBooting(false);
      const code = start?.startsWith('link_') ? '' : start?.replace(/^join[_-]?/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code && code.length >= 6) navigate(session ? `/j/${code}` : `/auth?next=${encodeURIComponent(`/j/${code}`)}`, { replace: true });
    });
  }, [booting, session]);

  if (booting) return <Loading label="Opening SHYST in Telegram" />;

  for (const r of ROUTES) {
    const params = match(r.pattern, path);
    if (!params) continue;
    if (!r.public && !session) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      let createFlow = false;
      try { createFlow = sessionStorage.getItem('crashout.link.flow') === 'create'; } catch { /* ignore */ }
      const mode = createFlow ? 'mode=signup&' : '';
      try { sessionStorage.setItem('crashout.link.authConfirmed', '1'); } catch { /* ignore */ }
      queueMicrotask(() => navigate(`/auth?${mode}next=${next}`, { replace: true }));
      return <Loading />;
    }
    const body = r.render(params);
    return r.shell && session ? <AppShell unread={unread}>{body}</AppShell> : <>{body}</>;
  }
  return session ? (
    <AppShell unread={unread}>
      <NotFound />
    </AppShell>
  ) : (
    <NotFound />
  );
}

export function App() {
  return (
    <RouterProvider>
      <OfflineBanner />
      <Routes />
      <Toasts />
    </RouterProvider>
  );
}
