export interface Env {
  DB: D1Database;
  ROOMS: DurableObjectNamespace;
  /** Public origin of the web app, e.g. https://tournament-platform.pages.dev */
  APP_URL: string;
  /** "production" disables every development shortcut. */
  ENVIRONMENT: string;
  /** Local development only: multiplies all room timers (e.g. 0.1). Ignored in production. */
  DEV_TIME_SCALE?: string;
  /** Comma-separated extra origins allowed for CORS (local dev). */
  ALLOWED_ORIGINS?: string;
  /** Comma-separated login handles that receive admin rights at registration. */
  ADMIN_HANDLES?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** Short name of the Mini App registered with BotFather (/newapp), used in t.me links. */
  TELEGRAM_MINIAPP_SHORTNAME?: string;
}

export function timeScale(env: Env): number {
  if (env.ENVIRONMENT === 'production') return 1;
  const n = Number(env.DEV_TIME_SCALE ?? '1');
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 1;
}
