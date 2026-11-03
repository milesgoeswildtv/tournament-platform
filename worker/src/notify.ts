import type { RoomState, FinalResults } from '../../shared/src/index';
import { formatMoney } from '../../shared/src/index';
import type { Env } from './env';
import type { SeqEvent } from './persist';
import { escapeHtml, sendTelegram } from './telegram';

interface Note {
  userId: string;
  kind: string;
  title: string;
  body: string;
  link: string;
}

/**
 * Notification channel. Every notice is stored in-app; players who signed in
 * through Telegram also get a bot message. Failures are logged, never fatal.
 */
export async function notifyEvents(env: Env, s: RoomState, events: SeqEvent[]): Promise<void> {
  const notes: Note[] = [];
  const link = `/t/${s.id}`;
  const members = Object.values(s.players).filter((p) => !p.left);
  for (const { event } of events) {
    if (event.type === 'COUNTDOWN_STARTED') {
      for (const p of members) {
        if (p.id === s.sponsorId) continue;
        notes.push({ userId: p.id, kind: 'countdown', title: s.title, body: 'The countdown has started. Stage 1 begins in 60 seconds.', link });
      }
    } else if (event.type === 'TOURNAMENT_FINISHED') {
      const f = event.data as unknown as FinalResults;
      for (const row of f.standings) {
        const won = f.allocations.filter((a) => a.playerId === row.playerId).reduce((t, a) => t + a.amountCents, 0);
        const prize = won > 0 ? ` Prize allocation: ${formatMoney(won, s.config.currency)} (sponsor commitment, unpaid).` : '';
        notes.push({ userId: row.playerId, kind: 'finished', title: s.title, body: `Final: #${row.rank} with ${row.stageWins} stage win${row.stageWins === 1 ? '' : 's'}.${prize}`, link: `/t/${s.id}/results` });
      }
      if (!f.standings.some((r) => r.playerId === s.sponsorId)) {
        notes.push({ userId: s.sponsorId, kind: 'finished', title: s.title, body: 'Your tournament finished. Results and prize allocations are ready.', link: `/t/${s.id}/results` });
      }
    } else if (event.type === 'TOURNAMENT_CANCELED' || event.type === 'TOURNAMENT_ABANDONED') {
      for (const p of members) {
        if (p.id === s.sponsorId && event.type === 'TOURNAMENT_CANCELED') continue;
        notes.push({ userId: p.id, kind: 'closed', title: s.title, body: event.type === 'TOURNAMENT_CANCELED' ? 'The sponsor canceled this tournament.' : 'This lobby expired before it started.', link });
      }
    }
  }
  if (!notes.length) return;
  const at = Date.now();
  await env.DB.batch(
    notes.map((n) => env.DB.prepare('INSERT INTO notifications (user_id, kind, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(n.userId, n.kind, n.title, n.body, n.link, at)),
  );
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const ids = [...new Set(notes.map((n) => n.userId))];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(`SELECT id, telegram_id FROM users WHERE telegram_id IS NOT NULL AND id IN (${placeholders})`)
    .bind(...ids)
    .all<{ id: string; telegram_id: string }>();
  const chat = new Map(rows.results.map((r) => [r.id, r.telegram_id]));
  await Promise.all(
    notes
      .filter((n) => chat.has(n.userId))
      .map((n) => sendTelegram(env, chat.get(n.userId)!, `<b>${escapeHtml(n.title)}</b>\n${escapeHtml(n.body)}`, n.link, 'Open').catch(() => null)),
  );
}
