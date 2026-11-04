import { useEffect, useRef, useState } from 'react';
import { GAME_IDS, GAME_META, defaultConfig, type GameId, type RoomView } from '../../../shared/src/index';
import { API_BASE, getToken, post, wsUrl, useSession } from '../lib/api';
import { Button, TextInput } from '../ui/controls';
import { Chip, Empty, Page, PageHead, Section, Text } from '../ui/layout';
import s from './bot-lab.module.css';

type BotStyle = 'random' | 'careful' | 'aggressive' | 'skilled' | 'chaotic';
type Bot = { index: number; handle: string; token: string; ws: WebSocket; view: RoomView | null; stop?: number; ready?: boolean; acted: Set<string> };
type Run = { id: string; invite: string; game: GameId; bots: Bot[]; host: WebSocket; started: boolean };

const API = async (method: string, path: string, body?: unknown, token?: string) => {
  const res = await fetch(`${API_BASE}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
  return data;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (n: number) => Math.floor(Math.random() * n);
const passwordFor = (i: number) => `ShystBot!2026-${String(i).padStart(2, '0')}`;

function actionFor(game: GameId, view: RoomView, style: BotStyle): unknown {
  const smart = style === 'skilled' || (style === 'careful' && Math.random() < 0.65);
  switch (game) {
    case 'guess-color': return { color: ['red', 'yellow', 'green', 'blue', 'white'][rand(5)] };
    case 'zero-hour': return { value: smart ? 50 + rand(5) - 2 : rand(101) };
    case 'high-low': {
      const p = view.me?.private as any;
      return { type: 'call', side: p?.number >= 50 ? 'high' : 'low' };
    }
    case 'decode': return { guess: smart ? 'a deliberately blind test guess' : ['nothing', 'shadow', 'river', 'stone'][rand(4)] };
    case 'suited-up': return { suit: ['spade', 'diamond', 'club', 'heart'][rand(4)] };
    case 'pressure-cooker': return { type: 'cashout' };
    case 'speedrun': return { answer: ['test', 'zero', 'wrong', '42'][rand(4)] };
    case 'flood': return { platform: rand(Math.max(1, Number((view.stage?.public as any)?.platforms ?? 4))) };
    case 'wrong-way': return { route: ['left', 'up', 'right', 'down', 'through'][rand(Math.max(1, Number((view.stage?.public as any)?.routes ?? 4)))] };
  }
}

function connectBot(index: number, token: string, tid: string, gameStyle: BotStyle, onLog: (line: string) => void): Promise<Bot> {
  const handle = `shystbot_${String(index).padStart(2, '0')}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(`/api/tournaments/${tid}/ws`), ['bearer', token]);
    const bot: Bot = { index, handle, token, ws, view: null, acted: new Set() };
    const timeout = window.setTimeout(() => reject(new Error(`${handle} connection timed out`)), 12000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'ping', at: Date.now() }));
    ws.onerror = () => { window.clearTimeout(timeout); reject(new Error(`${handle} could not connect`)); };
    ws.onmessage = (event) => {
      let msg: any;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (msg.t === 'error') onLog(`${handle}: ${msg.code}`);
      if (msg.t !== 'state') return;
      bot.view = msg.view as RoomView;
      if (bot.view.phase === 'ROUND' && bot.view.stage && bot.view.me?.status === 'alive' && !bot.view.me.submitted) {\n        const privateState = bot.view.me.private as any;\n        const key = `${bot.view.stage.index}:${bot.view.stage.round}`;\n        if (bot.view.stage.gameId === 'high-low' && privateState && !privateState.call && !privateState.rerolled && privateState.number >= 35 && privateState.number <= 65 && !bot.acted.has(`${key}:reroll`)) {\n          bot.acted.add(`${key}:reroll`);\n          ws.send(JSON.stringify({ t: 'act', stage: bot.view.stage.index, round: bot.view.stage.round, action: { type: 'reroll' } }));\n          return;\n        }
        const key = `${bot.view.stage.index}:${bot.view.stage.round}`;
        if (!bot.acted.has(key)) {
          bot.acted.add(key);
          const delay = gameStyle === 'aggressive' ? 180 : gameStyle === 'careful' ? 1200 : 450 + rand(900);
          bot.stop = window.setTimeout(() => {
            const v = bot.view;
            if (!v || v.phase !== 'ROUND' || !v.stage || v.stage.index !== bot.view?.stage?.index || v.stage.round !== bot.view?.stage?.round || v.me?.submitted) return;
            ws.send(JSON.stringify({ t: 'act', stage: v.stage.index, round: v.stage.round, action: actionFor(v.stage.gameId, v, gameStyle) }));
          }, delay);
        }
      }
      if (bot.view.phase === 'LOBBY' && !bot.stop) onLog(`${handle} connected`);
      if (bot.view.phase === 'FINISHED') onLog(`${handle}: tournament finished`);
      if (!bot.ready) { bot.ready = true; window.clearTimeout(timeout); resolve(bot); }
    };
    ws.onclose = () => { if (bot.stop) window.clearTimeout(bot.stop); };
  });
}

export function BotLabScreen() {
  const session = useSession();
  const [count, setCount] = useState(5);
  const [game, setGame] = useState<GameId>('guess-color');
  const [style, setStyle] = useState<BotStyle>('random');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState('');
  const runRef = useRef<Run | null>(null);
  const log = (line: string) => setLogs((old) => [`${new Date().toLocaleTimeString()}  ${line}`, ...old].slice(0, 80));
  const admin = !!session?.user.isAdmin;

  useEffect(() => () => {
    const r = runRef.current;
    if (r) { r.bots.forEach((b) => b.ws.close()); r.host.close(); }
  }, []);

  const start = async () => {
    setBusy(true); setError(''); setLogs([]);
    const token = getToken();
    if (!token) { setError('Sign in again before starting a test.'); setBusy(false); return; }
    let host: WebSocket | null = null;
    const bots: Bot[] = [];
    try {
      const cfg = defaultConfig();
      cfg.title = `BOT LAB — ${GAME_META[game].name} — ${new Date().toLocaleString()}`;
      cfg.stages = 10;
      cfg.games = { selection: 'MANUAL', manual: Array(10).fill(game), pool: [] };
      cfg.timer = { minSeconds: 15, maxSeconds: 15 };
      cfg.entry.maxPlayers = count + 1;
      cfg.entry.hostCompetes = false;
      cfg.entry.visibility = 'PRIVATE';
      cfg.invite.maxUses = count;
      cfg.payout.stageAwardCents = 1;
      cfg.payout.finalAwardCents = 0;
      cfg.specialAwards = [];
      const created = await API('POST', '/api/tournaments', { config: cfg }, token);
      log(`Created private test room ${created.id}`);
      for (let i = 1; i <= count; i++) {
        const handle = `shystbot_${String(i).padStart(2, '0')}`;
        const password = passwordFor(i);
        let auth: any;
        try { auth = await API('POST', '/api/auth/register', { handle, password, displayName: `SHYST BOT ${String(i).padStart(2, '0')}` }); }
        catch (e) {
          auth = await API('POST', '/api/auth/login', { handle, password });
        }
        await API('POST', '/api/join', { code: created.invite.code }, auth.token);
        log(`${handle} joined`);
        const bot = await connectBot(i, auth.token, created.id, style, log);
        bots.push(bot);
      }
      host = new WebSocket(wsUrl(`/api/tournaments/${created.id}/ws`), ['bearer', token]);
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('Host connection timed out')), 10000);
        host!.onopen = () => { host!.send(JSON.stringify({ t: 'ping', at: Date.now() })); window.clearTimeout(timer); resolve(); };
        host!.onerror = () => { window.clearTimeout(timer); reject(new Error('Could not connect the host to the test room')); };
      });
      const next: Run = { id: created.id, invite: created.invite.code, game, bots, host, started: false };
      runRef.current = next; setRun(next);
      await wait(500);
      host.send(JSON.stringify({ t: 'start' }));
      next.started = true;
      log(`Countdown started with ${bots.length} bots. All bot actions go through normal server validation.`);
    } catch (e) {
      bots.forEach((b) => b.ws.close()); host?.close();
      setError(e instanceof Error ? e.message : 'Could not start bot test.');
      log(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };

  const stop = () => {
    const r = runRef.current;
    if (!r) return;
    r.bots.forEach((b) => b.ws.close());
    r.host.close();
    runRef.current = null; setRun(null);
    log('Disconnected all test bots. The tournament record remains in your history.');
  };

  if (!admin) return <Page><Empty title="Admins only">The bot lab is restricted to SHYST administrators.</Empty></Page>;
  return <Page>
    <PageHead title="Bot lab" lede="Private test tournaments. Bots use ordinary player accounts, WebSockets and server-validated actions. No hidden answers." />
    <Section title="Run a game">
      <div className={s.form}>
        <label>Game<select value={game} disabled={busy || !!run} onChange={(e) => setGame(e.target.value as GameId)}>{GAME_IDS.map((id) => <option key={id} value={id}>{GAME_META[id].name}</option>)}</select></label>
        <label>Bot count <select value={count} disabled={busy || !!run} onChange={(e) => setCount(Number(e.target.value))}>{[2,3,4,5,6,8,10,12,16,20].map((n) => <option key={n} value={n}>{n} bots</option>)}</select></label>
        <label>Bot behavior <select value={style} disabled={busy || !!run} onChange={(e) => setStyle(e.target.value as BotStyle)}><option value="random">Random</option><option value="careful">Careful</option><option value="aggressive">Fast / aggressive</option><option value="skilled">Skilled guesses</option><option value="chaotic">Chaotic</option></select></label>
        <Button onClick={start} disabled={busy || !!run}>{busy ? 'Building test room…' : 'Create room & run bots'}</Button>
      </div>
      <Text tone="dust" size="sm">Creates a private 10-stage tournament using the selected game. Each bot account is reused on later runs. The host does not compete. The configured prize is a one-cent test award, not a payment.</Text>
    </Section>
    {run && <Section title="Live test" aside={<Chip tone="live" dot>Connected</Chip>}>
      <div className={s.live}><b>{GAME_META[run.game].name}</b><span>{run.bots.length} bots connected</span><span>Room: {run.id}</span><span>Invite: {run.invite}</span><Button variant="danger" onClick={stop}>Disconnect bots</Button></div>
      <div className={s.botList}>{run.bots.map((b) => <div key={b.handle}><b>{b.handle}</b><span>{b.view?.phase ?? 'Connecting'}{b.view?.stage ? ` · Round ${b.view.stage.round}` : ''}</span><Chip tone={b.view?.me?.status === 'eliminated' ? 'danger' : 'good'}>{b.view?.me?.status ?? 'Waiting'}</Chip></div>)}</div>
    </Section>}
    <Section title="Activity log">
      {logs.length ? <pre className={s.log}>{logs.join('\n')}</pre> : <Empty title="No test activity yet">Create a room to see bot connections and tournament events here.</Empty>}
      {error && <Text tone="danger">{error}</Text>}
    </Section>
  </Page>;
}
