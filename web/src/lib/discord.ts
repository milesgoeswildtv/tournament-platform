import { post, type User } from './api';

/** Messages for ?discord=… after the OAuth round trip. */
export const DISCORD_RESULT: Record<string, { text: string; tone: 'good' | 'error' }> = {
  linked: { text: 'Discord linked. It now signs you in as this player.', tone: 'good' },
  taken: { text: 'That Discord account already signs in as another SHYST player. Nothing was changed.', tone: 'error' },
  other: { text: 'This player is already linked to a different Discord account.', tone: 'error' },
  denied: { text: 'Discord sign-in was cancelled.', tone: 'error' },
  expired: { text: 'That Discord sign-in expired. Try again.', tone: 'error' },
  failed: { text: 'Discord didn’t confirm the sign-in. Try again in a moment.', tone: 'error' },
};

/** Starts the Discord OAuth round trip in this tab. Linking needs the player's session. */
export async function startDiscord(mode: 'login' | 'link', next = '/'): Promise<{ linked?: boolean }> {
  const r = await post<{ url?: string; linked?: boolean }>('/api/auth/discord/start', { mode, next });
  if (r.url) window.location.assign(r.url);
  return r;
}

export const completeDiscord = (pending: string, action: 'create' | 'link') => post<{ token?: string; user: User; linked?: boolean }>('/api/auth/discord/complete', { pending, action });
export const exchangeDiscordTicket = (ticket: string) => post<{ token: string; user: User }>('/api/auth/discord/exchange', { ticket });
