import { useEffect, useState, type ReactNode } from 'react';
import { RouterProvider, match, navigate, useLocation } from './lib/router';
import { get, useSession, updateUser } from './lib/api';
import { bootTelegram, inTelegram } from './lib/telegram';
import { AppShell, OfflineBanner, Toasts } from './ui/shell';
import { Loading } from './ui/layout';
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
import { NotFound } from './screens/NotFound';

type R = { pattern: string; render: (p: Record<string, string>) => ReactNode; shell?: boolean; public?: boolean };

const ROUTES: R[] = [
  { pattern: '/', render: () => <HubScreen />, shell: true },
  { pattern: '/auth', render: () => <AuthScreen />, public: true },
  { pattern: '/auth/discord', render: () => <DiscordScreen />, public: true },
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

function Routes() {
  const session = useSession();
  const { path } = useLocation();
  const [booting, setBooting] = useState(inTelegram());
  const unread = useUnread(!!session, path);

  useEffect(() => {
    if (!booting) return;
    bootTelegram(!!session).then((start) => {
      setBooting(false);
      const code = start?.replace(/^join[_-]?/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code && code.length >= 6) navigate(`/j/${code}`, { replace: true });
    });
  }, [booting, session]);

  if (booting) return <Loading label="Signing in with Telegram" />;

  for (const r of ROUTES) {
    const params = match(r.pattern, path);
    if (!params) continue;
    if (!r.public && !session) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      queueMicrotask(() => navigate(`/auth?next=${next}`, { replace: true }));
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
