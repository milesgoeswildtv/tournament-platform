import { RoomCore, secureRng, LIMITS, type RoomState, type ClientMessage, type ServerMessage, type TournamentConfig, type GameId } from '../../shared/src/index';
import type { Env } from './env';
import { persistEvents, type SeqEvent } from './persist';
import { notifyEvents } from './notify';

interface Attachment {
  userId: string;
}

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });

/**
 * One Durable Object per tournament. It is the only writer of live room
 * state: it decides phases, timers (via alarms), accepted submissions,
 * eliminations and results. Clients only send intents.
 */
export class TournamentRoom {
  private core: RoomCore | null = null;
  private seq = 0;
  private outbox: SeqEvent[] = [];
  private flushChain: Promise<void> = Promise.resolve();
  private buckets = new WeakMap<WebSocket, { tokens: number; at: number; chatAt: number }>();

  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    ctx.blockConcurrencyWhile(async () => {
      const room = await ctx.storage.get<RoomState>('room');
      if (room) this.core = new RoomCore(room, secureRng);
      this.seq = (await ctx.storage.get<number>('seq')) ?? 0;
      this.outbox = (await ctx.storage.get<SeqEvent[]>('outbox')) ?? [];
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const now = Date.now();
    if (url.pathname === '/init' && req.method === 'POST') {
      if (this.core) return json({ ok: false, error: 'exists' }, 409);
      const { state } = (await req.json()) as { state: RoomState };
      this.core = new RoomCore(state, secureRng);
      this.core.events.push({
        type: 'TOURNAMENT_CREATED',
        actorId: state.sponsorId,
        at: now,
        data: { configHash: state.configHash, sequence: state.sequence, config: state.config },
      });
      this.core.events.push({
        type: 'PLAYER_JOINED',
        actorId: state.sponsorId,
        at: now,
        data: { playerId: state.sponsorId, name: state.players[state.sponsorId].name, eligibleFrom: 1, late: false, via: 'host' },
      });
      await this.commit(now, true);
      return json({ ok: true });
    }
    const core = this.core;
    if (!core) return json({ ok: false, error: 'not_found' }, 404);
    core.advance(now);

    switch (url.pathname) {
      case '/ws':
        return this.acceptSocket(req, core, now);
      case '/view': {
        const userId = url.searchParams.get('userId');
        await this.commit(now);
        return json(core.view(userId, now));
      }
      case '/can-join': {
        await this.commit(now);
        return json(core.canJoin(url.searchParams.get('userId') ?? ''));
      }
      case '/join': {
        const { user, via } = (await req.json()) as { user: { id: string; name: string; tag: string }; via: string | null };
        const r = core.join(user, now, via);
        await this.commit(now, true);
        return json(r, r.ok ? 200 : 409);
      }
      case '/leave': {
        const { userId } = (await req.json()) as { userId: string };
        const r = core.leave(userId, now);
        await this.commit(now, true);
        return json(r, r.ok ? 200 : 409);
      }
      case '/config': {
        const body = (await req.json()) as { userId: string; config: TournamentConfig; configHash: string; sequence: GameId[] };
        if (body.userId !== core.s.sponsorId) return json({ ok: false, error: 'not_sponsor' }, 403);
        if (core.s.phase !== 'LOBBY') return json({ ok: false, error: 'not_in_lobby' }, 409);
        const others = core.competitors().filter((p) => p.id !== core.s.sponsorId).length;
        if (others + (body.config.entry.hostCompetes ? 1 : 0) > body.config.entry.maxPlayers) {
          return json({ ok: false, error: 'cap_below_players' }, 409);
        }
        core.s.config = body.config;
        core.s.configHash = body.configHash;
        core.s.sequence = body.sequence;
        core.s.title = body.config.title;
        const host = core.s.players[core.s.sponsorId];
        if (host) host.competes = body.config.entry.hostCompetes;
        core.events.push({ type: 'CONFIG_UPDATED', actorId: body.userId, at: now, data: { configHash: body.configHash } });
        await this.commit(now, true);
        return json({ ok: true });
      }
      default:
        return json({ ok: false, error: 'not_found' }, 404);
    }
  }

  private async acceptSocket(req: Request, core: RoomCore, now: number): Promise<Response> {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'expected_websocket' }, 426);
    const userId = req.headers.get('x-user-id');
    if (!userId || !core.s.players[userId]) return json({ error: 'not_a_member' }, 403);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({ userId } satisfies Attachment);
    core.setConnected(userId, true, now);
    await this.commit(now);
    const headers: Record<string, string> = {};
    if (req.headers.get('sec-websocket-protocol')?.split(',').map((s) => s.trim()).includes('bearer')) headers['sec-websocket-protocol'] = 'bearer';
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const core = this.core;
    if (!core) return;
    const { userId } = (ws.deserializeAttachment() as Attachment) ?? {};
    if (!userId) return;
    const send = (m: ServerMessage) => {
      try {
        ws.send(JSON.stringify(m));
      } catch {
        /* socket closing */
      }
    };
    if (typeof raw !== 'string' || raw.length > 4096) return send({ t: 'error', code: 'bad_message' });
    const now = Date.now();
    // Token bucket: 10 messages/second sustained, burst 20.
    const b = this.buckets.get(ws) ?? { tokens: 20, at: now, chatAt: 0 };
    b.tokens = Math.min(20, b.tokens + ((now - b.at) / 1000) * 10);
    b.at = now;
    this.buckets.set(ws, b);
    if (b.tokens < 1) return send({ t: 'error', code: 'rate_limited' });
    b.tokens -= 1;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return send({ t: 'error', code: 'bad_message' });
    }
    core.advance(now);
    let result: { ok: boolean; error?: string } = { ok: true };
    switch (msg?.t) {
      case 'ping':
        send({ t: 'pong', at: Number(msg.at) || 0, serverNow: now });
        send({ t: 'state', view: core.view(userId, now) });
        await this.commit(now);
        return;
      case 'act':
        result = core.act(userId, msg, now);
        break;
      case 'chat':
        if (now - b.chatAt < 700) return send({ t: 'error', code: 'rate_limited' });
        b.chatAt = now;
        result = core.chat(userId, String(msg.text ?? '').slice(0, LIMITS.chatMax * 2), now);
        break;
      case 'start':
        result = core.start(userId, now);
        break;
      case 'abort':
        result = core.abortCountdown(userId, now);
        break;
      case 'cancel':
        result = core.cancel(userId, now);
        break;
      case 'leave':
        result = core.leave(userId, now);
        break;
      default:
        return send({ t: 'error', code: 'bad_message' });
    }
    if (!result.ok) send({ t: 'error', code: result.error ?? 'error', ref: msg.t });
    await this.commit(now);
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    await this.dropSocket(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'closing');
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropSocket(ws);
  }

  private async dropSocket(ws: WebSocket) {
    const core = this.core;
    if (!core) return;
    const { userId } = (ws.deserializeAttachment() as Attachment) ?? {};
    if (!userId) return;
    const others = this.ctx.getWebSockets(userId).filter((w) => w !== ws && w.readyState === 1);
    if (others.length === 0) {
      const now = Date.now();
      core.advance(now);
      core.setConnected(userId, false, now);
      await this.commit(now);
    }
  }

  async alarm(): Promise<void> {
    const core = this.core;
    if (!core) return;
    const now = Date.now();
    core.advance(now);
    await this.commit(now);
    if (this.outbox.length) this.kickFlush();
  }

  /**
   * Persist state, schedule the next server deadline, broadcast fresh views,
   * and queue the emitted events for D1. `waitForDb` makes HTTP callers see
   * the database already updated when they get a response.
   */
  private async commit(now: number, waitForDb = false): Promise<void> {
    const core = this.core!;
    const events = core.drainEvents();
    core.replies.splice(0);
    for (const event of events) this.outbox.push({ seq: ++this.seq, event });
    await this.ctx.storage.put({ room: core.s, seq: this.seq, outbox: this.outbox });
    await this.schedule();
    if (events.length) this.broadcast(now);
    this.kickFlush();
    if (waitForDb) await this.flushChain;
  }

  private async schedule() {
    const d = this.core!.nextDeadline();
    const retry = this.outbox.length ? Date.now() + 5000 : null;
    const at = d !== null && retry !== null ? Math.min(d, retry) : (d ?? retry);
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  private broadcast(now: number) {
    const core = this.core!;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att) continue;
      try {
        ws.send(JSON.stringify({ t: 'state', view: core.view(att.userId, now) } satisfies ServerMessage));
      } catch {
        /* closed */
      }
    }
  }

  private kickFlush() {
    this.flushChain = this.flushChain.then(() => this.flush()).catch((e) => console.error('flush failed', e));
  }

  private async flush(): Promise<void> {
    while (this.outbox.length) {
      const batch = this.outbox.slice(0, 40);
      const last = batch[batch.length - 1].seq;
      try {
        await persistEvents(this.env, this.core!.s, batch);
      } catch (e) {
        console.error('D1 persist failed; will retry', e);
        await this.schedule();
        return;
      }
      this.outbox = this.outbox.filter((p) => p.seq > last);
      await this.ctx.storage.put('outbox', this.outbox);
      notifyEvents(this.env, this.core!.s, batch).catch((e) => console.error('notify failed', e));
    }
    await this.schedule();
  }
}
