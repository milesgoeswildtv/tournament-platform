import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomView, ServerMessage, ClientMessage } from '@shared/client';
import { ERROR_TEXT } from '@shared/client';
import { getToken, wsUrl } from './api';
import { toast } from './toast';

export type RoomStatus = 'connecting' | 'open' | 'reconnecting' | 'refused';

/**
 * Live connection to a tournament room. The server sends a complete,
 * personalised view after every change, so the client keeps no game state of
 * its own and a reconnect simply resumes from the next view.
 *
 * Clock: offset = serverNow − local time, estimated from ping round trips so
 * every device shows the same deadline the server enforces.
 */
export function useRoom(tid: string) {
  const [view, setView] = useState<RoomView | null>(null);
  const [status, setStatus] = useState<RoomStatus>('connecting');
  const [lastError, setLastError] = useState<{ code: string; ref?: string; at: number } | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const offset = useRef(0);
  const bestRtt = useRef(Infinity);

  useEffect(() => {
    let alive = true;
    let attempt = 0;
    let everOpened = false;
    let retry: number | undefined;
    let ping: number | undefined;

    const connect = () => {
      const token = getToken();
      if (!token) {
        setStatus('refused');
        return;
      }
      setStatus(everOpened ? 'reconnecting' : 'connecting');
      const sock = new WebSocket(wsUrl(`/api/tournaments/${tid}/ws`), ['bearer', token]);
      ws.current = sock;
      let opened = false;
      sock.onopen = () => {
        opened = true;
        everOpened = true;
        attempt = 0;
        setStatus('open');
        sock.send(JSON.stringify({ t: 'ping', at: Date.now() } satisfies ClientMessage));
        window.clearInterval(ping);
        ping = window.setInterval(() => sock.readyState === 1 && sock.send(JSON.stringify({ t: 'ping', at: Date.now() })), 15_000);
      };
      sock.onmessage = (ev) => {
        let m: ServerMessage;
        try {
          m = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (m.t === 'state') {
          if (bestRtt.current === Infinity) offset.current = m.view.serverNow - Date.now();
          setView(m.view);
        } else if (m.t === 'pong') {
          const now = Date.now();
          const rtt = now - m.at;
          if (rtt >= 0 && rtt <= bestRtt.current * 1.5 + 20) {
            bestRtt.current = Math.min(bestRtt.current, rtt);
            offset.current = m.serverNow - (m.at + now) / 2;
          }
        } else if (m.t === 'error') {
          setLastError({ code: m.code, ref: m.ref, at: Date.now() });
          if (m.code !== 'rate_limited' || m.ref === 'chat') toast(ERROR_TEXT[m.code] ?? 'That action was refused.', 'error');
        }
      };
      sock.onclose = () => {
        window.clearInterval(ping);
        if (!alive) return;
        if (!opened && !everOpened && attempt >= 2) {
          setStatus('refused');
          return;
        }
        attempt++;
        setStatus('reconnecting');
        retry = window.setTimeout(connect, Math.min(8000, 400 * 2 ** Math.min(attempt, 5)));
      };
    };

    connect();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && ws.current && ws.current.readyState > 1) {
        window.clearTimeout(retry);
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      alive = false;
      window.clearTimeout(retry);
      window.clearInterval(ping);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      ws.current?.close(1000);
    };
  }, [tid]);

  const send = useCallback((m: ClientMessage) => {
    const s = ws.current;
    if (!s || s.readyState !== 1) {
      toast('Reconnecting — try again in a moment.', 'error');
      return false;
    }
    s.send(JSON.stringify(m));
    return true;
  }, []);

  const serverNow = useCallback(() => Date.now() + offset.current, []);

  return { view, status, send, serverNow, lastError };
}

/** Re-renders every `ms` while `active`, returning the current server time. */
export function useTicker(serverNow: () => number, ms = 200, active = true): number {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setN((x) => x + 1), ms);
    return () => window.clearInterval(id);
  }, [ms, active]);
  return serverNow();
}
