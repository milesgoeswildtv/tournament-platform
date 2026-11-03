/**
 * Stand-in for discord.com used by browser tests: an authorize page that
 * "consents" as `current` and redirects back with a code, plus the token,
 * users/@me and revoke endpoints with the same checks Discord applies.
 */
import { createServer, type Server } from 'node:http';

export interface FakeProfile {
  id: string;
  username: string;
  global_name: string | null;
}

export async function startFakeDiscord(clientId: string, secret: string) {
  const codes = new Map<string, FakeProfile>();
  const tokens = new Map<string, FakeProfile>();
  const state = { current: null as FakeProfile | null, deny: false };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const form = new URLSearchParams(Buffer.concat(chunks).toString());
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/oauth2/authorize') {
      const back = new URL(url.searchParams.get('redirect_uri')!);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      if (state.deny || !state.current || url.searchParams.get('client_id') !== clientId) back.searchParams.set('error', 'access_denied');
      else {
        const code = `c${Math.random().toString(36).slice(2)}`;
        codes.set(code, state.current);
        back.searchParams.set('code', code);
      }
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === '/api/oauth2/token') {
      const p = codes.get(form.get('code') ?? '');
      if (form.get('client_secret') !== secret || !p) return send(400, { error: 'invalid_grant' });
      codes.delete(form.get('code')!);
      const at = `t${Math.random().toString(36).slice(2)}`;
      tokens.set(at, p);
      return send(200, { access_token: at, token_type: 'Bearer' });
    }
    if (url.pathname === '/api/users/@me') {
      const p = tokens.get((req.headers.authorization ?? '').replace('Bearer ', ''));
      return p ? send(200, p) : send(401, {});
    }
    if (url.pathname === '/api/oauth2/token/revoke') {
      tokens.delete(form.get('token') ?? '');
      return send(200, {});
    }
    send(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { base, api: `${base}/api`, authorize: `${base}/oauth2/authorize`, state, close: () => server.close() };
}
