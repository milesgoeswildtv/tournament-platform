import { post, setSession, type User } from './api';
import { toast } from './toast';

/**
 * Telegram Mini App support. The app runs the same in a normal browser; inside
 * Telegram it signs in with the signed initData (validated on the server) and
 * honours start parameters such as invite codes.
 */
interface TgWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  disableVerticalSwipes?(): void;
  openTelegramLink?(url: string): void;
}

const tg = () => (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;

/** Raw initData, from the SDK if loaded or straight from the launch URL hash. */
export function telegramInitData(): string | null {
  const fromSdk = tg()?.initData;
  if (fromSdk) return fromSdk;
  try {
    const h = new URLSearchParams(window.location.hash.slice(1));
    return h.get('tgWebAppData');
  } catch {
    return null;
  }
}

export const inTelegram = () => !!telegramInitData();

let sdk: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  sdk ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
  return sdk;
}

type TgAuth = { token: string; user: User; startParam: string | null; link: { ok: boolean; message: string; reconciled?: string } | null };

function reportLink(link: TgAuth['link']) {
  if (!link) return;
  toast(link.ok && link.reconciled ? `${link.message} The empty Telegram-only player #${link.reconciled} was folded into this one.` : link.message, link.ok ? 'good' : 'error');
}

/**
 * Opens a t.me link. Inside the Mini App it goes through Telegram. In a
 * browser, call `reserveTab()` synchronously in the tap handler first (iOS
 * blocks window.open after an await) and pass the reserved tab here.
 */
export function reserveTab(): Window | null {
  return inTelegram() ? null : window.open('about:blank', '_blank');
}
export function openTelegram(url: string, tab: Window | null = null) {
  const app = tg();
  if (app?.openTelegramLink && inTelegram()) app.openTelegramLink(url);
  else if (tab && !tab.closed) tab.location.href = url;
  else window.location.href = url;
}

/**
 * Inside the Mini App, after signing in with a username and password, attach
 * this Telegram account to that player (server-verified initData + the new session).
 */
export async function linkInMiniApp(): Promise<void> {
  const initData = telegramInitData();
  if (!initData) return;
  try {
    const r = await post<TgAuth>('/api/auth/telegram', { initData });
    setSession({ token: r.token, user: r.user });
    reportLink(r.link);
  } catch {
    /* sign-in already succeeded; linking can be retried from Settings */
  }
}

/** Returns the start parameter (e.g. an invite code) if the app was opened with one. */
export async function signInWithTelegram(): Promise<TgAuth> {
  const initData = telegramInitData();
  if (!initData) throw new Error('Open SHYST from the Telegram bot to use Telegram sign-in.');
  const r = await post<TgAuth>('/api/auth/telegram', { initData });
  setSession({ token: r.token, user: r.user });
  reportLink(r.link);
  return r;
}

/** Initializes the Mini App shell without silently signing the player in. */
export async function bootTelegram(_hasSession: boolean): Promise<string | null> {
  const initData = telegramInitData();
  if (!initData) return null;
  await loadSdk();
  const app = tg();
  try {
    app?.ready();
    app?.expand();
    app?.setHeaderColor?.('#0e0e0c');
    app?.setBackgroundColor?.('#0e0e0c');
    app?.disableVerticalSwipes?.();
  } catch {
    /* older clients */
  }
  // Preserve invite and linking start parameters while leaving the auth choice
  // to the player on the SHYST sign-in / create-account screen.
  try {
    return new URLSearchParams(initData).get('start_param');
  } catch {
    return null;
  }
}
