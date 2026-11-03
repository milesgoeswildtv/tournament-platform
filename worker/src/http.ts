import type { Env } from './env';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 32_768): Promise<T> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > maxBytes) throw new HttpError(413, 'payload_too_large');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'payload_too_large');
  if (!text) return {} as T;
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as T;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

export interface RouteCtx {
  req: Request;
  env: Env;
  exec: ExecutionContext;
  params: Record<string, string>;
  url: URL;
}

type Handler = (c: RouteCtx) => Promise<Response> | Response;

export class Router {
  private routes: { method: string; parts: string[]; handler: Handler }[] = [];

  on(method: string, path: string, handler: Handler) {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler });
    return this;
  }
  get(p: string, h: Handler) { return this.on('GET', p, h); }
  post(p: string, h: Handler) { return this.on('POST', p, h); }
  patch(p: string, h: Handler) { return this.on('PATCH', p, h); }
  delete(p: string, h: Handler) { return this.on('DELETE', p, h); }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    let methodMismatch = false;
    for (const r of this.routes) {
      if (r.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const rp = r.parts[i];
        if (rp.startsWith(':')) params[rp.slice(1)] = decodeURIComponent(parts[i]);
        else if (rp !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (r.method !== method) {
        methodMismatch = true;
        continue;
      }
      return { handler: r.handler, params };
    }
    if (methodMismatch) throw new HttpError(405, 'method_not_allowed');
    return null;
  }
}

export function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return {};
  const allowed = new Set([env.APP_URL, ...(env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim())].filter(Boolean));
  if (!allowed.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '600',
    vary: 'origin',
  };
}

export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
}

export function str(v: unknown, field: string, min: number, max: number): string {
  if (typeof v !== 'string') throw new HttpError(400, 'invalid_input', `${field} is required`, { field });
  const s = v.trim();
  if (s.length < min || s.length > max) throw new HttpError(400, 'invalid_input', `${field} must be ${min}–${max} characters`, { field });
  return s;
}
