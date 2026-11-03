import { post, setSession, type User } from './api';

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

/** Returns the start parameter (e.g. an invite code) if the app was opened with one. */
export async function bootTelegram(hasSession: boolean): Promise<string | null> {
  const initData = telegramInitData();
  if (!initData) return null;
  await loadSdk();
  const app = tg();
  try {
    app?.ready();
    app?.expand();
    app?.setHeaderColor?.('#060606');
    app?.setBackgroundColor?.('#060606');
    app?.disableVerticalSwipes?.();
  } catch {
    /* older clients */
  }
  try {
    const r = await post<{ token: string; user: User; startParam: string | null }>('/api/auth/telegram', { initData });
    if (!hasSession || r.user) setSession({ token: r.token, user: r.user });
    return r.startParam;
  } catch {
    return null;
  }
}
