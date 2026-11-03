import { useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { IconButton } from './controls';
import { Link, useLocation } from '../lib/router';
import { useToasts, dismiss } from '../lib/toast';
import { setPrefs, usePrefs } from '../lib/prefs';
import { audio } from '../lib/audio';
import { TapeMark } from './venue';
import s from './shell.module.css';

const TABS: { to: string; label: string; icon: IconName; match: RegExp }[] = [
  { to: '/', label: 'Hub', icon: 'hub', match: /^\/$/ },
  { to: '/join', label: 'Join', icon: 'join', match: /^\/(join|j)(\/|$)/ },
  { to: '/sponsor', label: 'Sponsor', icon: 'sponsor', match: /^\/sponsor/ },
  { to: '/ranks', label: 'Ranks', icon: 'ranks', match: /^\/ranks/ },
  { to: '/me', label: 'Profile', icon: 'profile', match: /^\/(me|p\/)/ },
];

const RAIL: typeof TABS = [
  ...TABS.slice(0, 3),
  { to: '/games', label: 'Game library', icon: 'library', match: /^\/games/ },
  { to: '/ranks', label: 'Leaderboards', icon: 'ranks', match: /^\/ranks/ },
  { to: '/me', label: 'Profile', icon: 'profile', match: /^\/(me|p\/)/ },
  { to: '/settings', label: 'Settings', icon: 'settings', match: /^\/settings/ },
];

/** The SHYST wordmark: stencil on a strip of tape. */
export function Wordmark() {
  return <TapeMark to="/" />;
}

export function MusicButton() {
  const p = usePrefs();
  return (
    <IconButton
      icon="music"
      label={p.music ? 'Turn music off' : 'Turn music on'}
      pressed={p.music}
      onClick={() => {
        setPrefs({ music: !p.music });
        audio.syncMusic();
      }}
    />
  );
}

/** Hub screens: top bar + bottom tabs on phones, a side rail on desktop. */
export function AppShell({ children, unread = 0 }: { children: ReactNode; unread?: number }) {
  const { path } = useLocation();
  return (
    <div className={s.shell}>
      <aside className={s.rail}>
        <Wordmark />
        <nav className={s.railNav} aria-label="Main">
          {RAIL.map((t) => (
            <Link key={t.label} to={t.to} className={s.railLink} aria-current={t.match.test(path) ? 'page' : undefined}>
              <Icon name={t.icon} />
              {t.label}
            </Link>
          ))}
        </nav>
        <div className={s.railFoot}>
          <MusicButton />
          <IconButton icon="bell" label="Notifications" to="/me#inbox" badge={unread} />
        </div>
      </aside>
      <header className={s.top}>
        <Wordmark />
        <div className={s.topActions}>
          <MusicButton />
          <IconButton icon="library" label="Game library" to="/games" />
          <IconButton icon="settings" label="Settings" to="/settings" badge={0} />
        </div>
      </header>
      <div className={s.main}>{children}</div>
      <nav className={s.tabs} aria-label="Main">
        {TABS.map((t) => (
          <Link key={t.to} to={t.to} className={s.tab} aria-current={t.match.test(path) ? 'page' : undefined}>
            <Icon name={t.icon} size={22} />
            {t.label}
            {t.to === '/me' && unread > 0 && <span className="sr-only">{unread} unread</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function Sheet({ open, title, onClose, children, tall }: { open: boolean; title: string; onClose: () => void; children: ReactNode; tall?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className={s.backdrop} onClick={onClose} aria-hidden />
      <div className={`${s.sheet} ${tall ? s.sheetTall : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className={s.sheetGrip} />
        <div className={s.sheetHead}>
          <h2 className={s.sheetTitle}>{title}</h2>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <div className={s.sheetBody}>{children}</div>
      </div>
    </>
  );
}

export function Toasts() {
  const items = useToasts();
  return (
    <div className={s.toasts} aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`${s.toast} ${s[`toast_${t.tone}`] ?? ''}`} role={t.tone === 'error' ? 'alert' : 'status'} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return <div className={s.offline}>You’re offline. Reconnect to keep playing.</div>;
}
