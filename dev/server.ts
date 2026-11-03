/**
 * Local development server: runs the real Worker (API + TournamentRoom Durable
 * Object) under Node using dev/runtime.ts, and serves the built web app from
 * the same origin.
 *
 *   npm run dev:local                 # http://localhost:8787
 *   PORT=9000 TIME_SCALE=0.2 npm run dev:local
 */
import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket as NodeWS } from 'ws';
import { DevD1, DevDONamespace, installRuntimeGlobals, type DevSocket } from './runtime';

installRuntimeGlobals();

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export interface DevServerOptions {
  port?: number;
  timeScale?: number;
  dbPath?: string;
  staticDir?: string | null;
  adminHandles?: string;
  quiet?: boolean;
  extraEnv?: Record<string, string>;
}

export interface DevServer {
  url: string;
  port: number;
  env: Record<string, unknown> & { DB: DevD1; ROOMS: DevDONamespace };
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

export async function startDevServer(opts: DevServerOptions = {}): Promise<DevServer> {
  const worker = (await import('../worker/src/index')).default;
  const { TournamentRoom } = await import('../worker/src/room');

  const db = new DevD1(opts.dbPath ?? ':memory:');
  db.migrate(join(ROOT, 'migrations'));

  const server = http.createServer();
  await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}`;

  // eslint-disable-next-line prefer-const
  let env: DevServer['env'];
  const rooms = new DevDONamespace(TournamentRoom as never, () => env);
  env = {
    DB: db,
    ROOMS: rooms,
    APP_URL: url,
    ENVIRONMENT: 'development',
    DEV_TIME_SCALE: String(opts.timeScale ?? 1),
    ALLOWED_ORIGINS: `http://localhost:${port},http://localhost:5173`,
    ADMIN_HANDLES: opts.adminHandles ?? 'admin',
    ...(opts.extraEnv ?? {}),
  };

  const exec = { waitUntil: (p: Promise<unknown>) => void p.catch((e) => console.error('[waitUntil]', e)), passThroughOnException() {} };
  const staticDir = opts.staticDir === undefined ? join(ROOT, 'web', 'dist') : opts.staticDir;

  const toRequest = (req: http.IncomingMessage, body?: Buffer) => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }
    if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', req.socket.remoteAddress ?? '127.0.0.1');
    return new Request(`${url}${req.url}`, { method: req.method, headers, body: body && body.length ? body : undefined });
  };

  const serveStatic = (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (!staticDir || !existsSync(staticDir)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('web/dist not built — run npm run build:web');
      return;
    }
    const path = decodeURIComponent(new URL(req.url ?? '/', url).pathname);
    let file = join(staticDir, path);
    if (!file.startsWith(staticDir) || !existsSync(file) || statSync(file).isDirectory()) file = join(staticDir, 'index.html');
    const ext = extname(file);
    const immutable = /\/assets\//.test(file);
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(readFileSync(file));
  };

  server.on('request', async (req, res) => {
    try {
      if (!req.url?.startsWith('/api/')) return serveStatic(req, res);
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const response = await worker.fetch(toRequest(req, Buffer.concat(chunks)) as never, env as never, exec as never);
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => (headers[k] = v));
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
      if (!opts.quiet) console.log(`${req.method} ${req.url} → ${response.status}`);
    } catch (e) {
      console.error(e);
      res.writeHead(500).end('dev server error');
    }
  });

  const wss = new WebSocketServer({ noServer: true, handleProtocols: (p) => (p.has('bearer') ? 'bearer' : false) });
  server.on('upgrade', async (req, socket, head) => {
    try {
      const response = (await worker.fetch(toRequest(req) as never, env as never, exec as never)) as Response & { webSocket?: DevSocket };
      if (response.status !== 101 || !response.webSocket) {
        const text = await response.text().catch(() => '');
        socket.end(`HTTP/1.1 ${response.status} Refused\r\ncontent-type: text/plain\r\ncontent-length: ${Buffer.byteLength(text)}\r\n\r\n${text}`);
        return;
      }
      const end = response.webSocket;
      wss.handleUpgrade(req, socket, head, (ws: NodeWS) => {
        end.onMessage = (data) => ws.readyState === ws.OPEN && ws.send(data);
        end.onClose = (code) => ws.readyState === ws.OPEN && ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000);
        end.flushPending();
        ws.on('message', (data) => {
          try {
            end.send(data.toString());
          } catch {
            /* closed */
          }
        });
        ws.on('close', (code, reason) => end.close(code || 1005, reason.toString()));
      });
    } catch (e) {
      console.error(e);
      socket.destroy();
    }
  });

  if (!opts.quiet) console.log(`dev server on ${url} (time scale ${opts.timeScale ?? 1})`);

  return {
    url,
    port,
    env,
    close: async () => {
      rooms.shutdown();
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => server.close(() => r()));
      server.closeAllConnections?.();
    },
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dataDir = join(ROOT, '.dev-data');
  mkdirSync(dataDir, { recursive: true });
  startDevServer({
    port: Number(process.env.PORT ?? 8787),
    timeScale: Number(process.env.TIME_SCALE ?? 1),
    dbPath: process.env.DB_PATH ?? ':memory:',
    adminHandles: process.env.ADMIN_HANDLES ?? 'admin',
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
