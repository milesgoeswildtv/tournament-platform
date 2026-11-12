import { requireUser } from './auth';
import type { RouteCtx } from './http';
import { HttpError, json, readJson } from './http';
import { rateLimit } from './security';

type CrashoutEnv = {
  CRASHOUT_SHYST_ADAPTER_KEY?: string;
  CRASHOUT_LINK_GATEWAY_URL?: string;
};

type GatewayResult = {
  link_id?: unknown;
  error?: unknown;
};

const DEFAULT_GATEWAY_URL =
  'https://qcmfnkuyinhfdxnuvneb.supabase.co/functions/v1/complete-destination-link';
const TOKEN_RE = /^[a-f0-9]{64}$/;

/**
 * Completes a CRASHOUT → SHYST link.
 *
 * The one-time proof comes from CRASHOUT. The destination identity is always
 * taken from the authenticated SHYST session; clients cannot choose a player
 * ID or link by matching profile data.
 */
export async function completeCrashoutLink(c: RouteCtx): Promise<Response> {
  const user = await requireUser(c);
  const env = c.env as typeof c.env & CrashoutEnv;
  const adapterKey = env.CRASHOUT_SHYST_ADAPTER_KEY;

  await rateLimit(c.env, `crashout-link-user:${user.id}`, 6, 600);
  await rateLimit(
    c.env,
    `crashout-link-ip:${c.req.headers.get('cf-connecting-ip') ?? 'unknown'}`,
    30,
    600,
  );

  if (!adapterKey || adapterKey.length < 32) {
    throw new HttpError(
      503,
      'crashout_link_unavailable',
      'CRASHOUT account linking is unavailable on this SHYST server.',
    );
  }

  const body = await readJson<{ token?: unknown }>(c.req, 2048);
  if (typeof body.token !== 'string' || !TOKEN_RE.test(body.token)) {
    throw new HttpError(400, 'invalid_link_token', 'The CRASHOUT link proof is invalid.');
  }

  let response: Response;
  try {
    response = await fetch(env.CRASHOUT_LINK_GATEWAY_URL || DEFAULT_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-crashout-adapter-key': adapterKey,
      },
      body: JSON.stringify({
        game_key: 'shyst',
        token: body.token,
        external_player_id: user.id,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(
      503,
      'crashout_link_unavailable',
      'CRASHOUT could not be reached. Your SHYST account has not been changed.',
    );
  }

  const result = await response.json().catch(() => null) as GatewayResult | null;

  if (!response.ok) {
    const code = typeof result?.error === 'string' ? result.error : '';
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(
        503,
        'crashout_adapter_rejected',
        'The private CRASHOUT connection rejected the SHYST adapter.',
      );
    }
    if (response.status === 409) {
      const message = code === 'identity_already_claimed'
        ? 'This CRASHOUT identity or SHYST player is already connected to a different account.'
        : code === 'destination_not_ready'
          ? 'SHYST is temporarily unavailable for account linking.'
          : 'This link proof is expired, already used, or belongs to another destination. Start a new link from CRASHOUT.';
      throw new HttpError(409, 'crashout_link_rejected', message);
    }
    if (response.status === 400) {
      throw new HttpError(400, 'crashout_link_invalid', 'CRASHOUT rejected the link proof. Start a new link from the hub.');
    }
    throw new HttpError(
      503,
      'crashout_link_unavailable',
      'CRASHOUT could not complete the link. Your SHYST account has not been changed.',
    );
  }

  if (typeof result?.link_id !== 'string' || !result.link_id) {
    throw new HttpError(
      502,
      'crashout_link_invalid_response',
      'CRASHOUT returned an invalid account-link response.',
    );
  }

  return json({ ok: true, linked: true, destination: 'shyst', linkId: result.link_id });
}
