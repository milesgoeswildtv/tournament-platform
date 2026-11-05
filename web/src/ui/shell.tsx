import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { IconButton, fieldStyles } from './controls';
import { Link, useLocation } from '../lib/router';
import { useToasts, dismiss } from '../lib/toast';
import { usePrefs, setPrefs } from '../lib/prefs';
import { audio } from '../lib/audio';
import { music } from '../lib/music';
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

export function Wordmark() {
  return <TapeMark to="/" />;
}

function HeaderMusicPlayer() {
  const prefs = usePrefs();
  const player = useSyncExternalStore(music.subscribe, music.getSnapshot, music.getSnapshot);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const changeVolume = (value: number) => {
    setPrefs({ musicVolume: value });
    audio.setMusicVolume(value);
  };

  return (
    <div className={s.musicDock} ref={root}>
      <IconButton
        icon="music"
        label={open ? 'Close music player' : 'Open music player'}
        pressed={open || player.playing}
        className={s.musicTrigger}
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <section className={s.musicPopover} aria-label="Music player">
          <div className={s.musicPopoverHead}>
            <div className={s.musicPopoverTitle}>NOW PLAYING</div>
            <span className={s.musicStatus}>{player.playing ? 'PLAYING' : prefs.music ? 'READY' : 'MUSIC OFF'}</span>
          </div>
          <div className={s.musicTrack}>
            <b title={player.track?.title ?? undefined}>{player.track?.title ?? 'No track selected'}</b>
            <span>{player.track ? player.track.category.toUpperCase() : 'Enable music in Settings'}</span>
          </div>
          <div className={s.musicActions}>
            <button type="button" aria-label="Previous track" title="Previous" disabled={!player.available} onClick={() => music.previous()}><Icon name="back" /></button>
            <button type="button" className={s.musicPlay} aria-label={player.playing ? 'Pause music' : 'Play music'} disabled={!prefs.music || !player.available} onClick={() => music.togglePlayback()}><Icon name={player.playing ? 'pause' : 'play'} size={21} /></button>
            <button type="button" aria-label="Next track" title="Next" disabled={!player.available} onClick={() => music.next()}><Icon name="next" /></button>
            <button type="button" aria-label={player.shuffle ? 'Turn shuffle off' : 'Turn shuffle on'} aria-pressed={player.shuffle} title="Shuffle" onClick={() => music.toggleShuffle()}><Icon name="shuffle" /></button>
          </div>
          <label className={s.musicVolume}>
            <span>VOLUME</span>
            <input aria-label="Music volume" type="range" min="0" max="1" step="0.05" value={prefs.musicVolume} onChange={(event) => changeVolume(Number(event.target.value))} />
            <output>{Math.round(prefs.musicVolume * 100)}%</output>
          </label>
          {!prefs.music && <p className={s.musicHint}>Turn Music on in Settings to start playback.</p>}
        </section>
      )}
    </div>
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
          <HeaderMusicPlayer />
          <IconButton icon="bell" label="Notifications" to="/me#inbox" badge={unread} />
        </div>
      </aside>
      <header className={s.top}>
        <Wordmark />
        <div className={s.topActions}>
          <HeaderMusicPlayer />
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
