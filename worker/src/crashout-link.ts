import { requireUser } from './auth';
import type { RouteCtx } from './http';
import { HttpError, json, readJson } from './http';
import { rateLimit } from './security';

type CrashoutEnv = { CRASHOUT_SHYST_ADAPTER_KEY?: string; CRASHOUT_LINK_GATEWAY_URL?: string };

const DEFAULT_GATEWAY_URL = 'https://qcmfnkuyinhfdxnuvneb.supabase.co/functions/v1/complete-destination-link';
const TOKEN_RE = /^[a-f0-9]{64}$/;

/**
 * Completes an explicit Crashout → SHYST account link.
 *
 * The browser can supply only the one-time Crashout token. The SHYST player
 * identity always comes from the authenticated SHYST session, never request
 * JSON, email, username, or a client-supplied player ID.
 */
export async function completeCrashoutLink(c: RouteCtx): Promise<Response> {
  const user = await requireUser(c);
  const adapterEnv = c.env as typeof c.env & CrashoutEnv;
  await rateLimit(c.env, `crashout-link-user:${user.id}`, 6, 600);
  await rateLimit(c.env, 'crashout-link-ip:' + (c.req.headers.get('cf-connecting-ip') ?? 'unknown'), 30, 600);

  if (!adapterEnv.CRASHOUT_SHYST_ADAPTER_KEY || c.env.CRASHOUT_SHYST_ADAPTER_KEY.length < 32) {
    throw new HttpError(503, 'crashout_link_unavailable', 'Crashout account linking is not configured on this server.');
  }

  const body = await readJson<{ token?: unknown }>(c.req, 2048);
  if (typeof body.token !== 'string' || !TOKEN_RE.test(body.token)) {
    throw new HttpError(400, 'invalid_link_token', 'The Crashout link token is invalid.');
  }

  const gatewayUrl = adapterEnv.CRASHOUT_LINK_GATEWAY_URL || DEFAULT_GATEWAY_URL;
  let response: Response;
  try {
    response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-crashout-adapter-key': c.env.CRASHOUT_SHYST_ADAPTER_KEY,
      },
      body: JSON.stringify({
        game_key: 'shyst',
        token: body.token,
        external_player_id: user.id,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(503, 'crashout_link_unavailable', 'Crashout could not be reached. Your SHYST account has not been changed.');
  }

  if (!response.ok) {
    if (response.status === 409 || response.status === 400) {
      throw new HttpError(409, 'crashout_link_rejected', 'This link is expired, already used, or cannot be completed. Start a new link from Crashout.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(503, 'crashout_link_unavailable', 'The Crashout adapter credentials need attention.');
    }
    throw new HttpError(503, 'crashout_link_unavailable', 'Crashout could not complete the link. Try again later.');
  }

  let result: { link_id?: unknown };
  try {
    result = await response.json() as { link_id?: unknown };
  } catch {
    throw new HttpError(502, 'crashout_link_invalid_response', 'Crashout returned an invalid response.');
  }
  if (typeof result.link_id !== 'string' || !result.link_id) {
    throw new HttpError(502, 'crashout_link_invalid_response', 'Crashout returned an invalid response.');
  }

  return json({ ok: true, linked: true, destination: 'shyst', linkId: result.link_id });
}
