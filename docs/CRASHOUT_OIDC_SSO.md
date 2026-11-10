# CRASHOUT OIDC SSO for SHYST

## Decision

CRASHOUT is the canonical identity provider. SHYST remains an independent destination with its own player record, tournament history, prizes, roles, and gameplay data. The legacy browser token-link flow is retired; it is not repaired or reused.

## First transition for an existing SHYST player

1. The player must already be signed in to their existing SHYST account. This is the proof of ownership of the legacy player record.
2. SHYST starts Authorization Code + PKCE against CRASHOUT. The authorization request includes `openid`, a random state, and a random nonce. The PKCE verifier and nonce are stored server-side in D1, bound to the authenticated SHYST user, and expire quickly.
3. CRASHOUT authenticates the person and obtains consent. SHYST's Worker exchanges the code server-side and validates the ID token against OIDC discovery/JWKS: exact issuer, audience/client ID, signature/algorithm, expiry, issued-at, nonce, and subject.
4. SHYST sends the verified ID token and its existing player ID to a dedicated CRASHOUT server-to-server claim endpoint. CRASHOUT independently verifies the token and atomically creates the `game_links(shyst, crashout_user_id, external_player_id)` mapping only if neither side is already linked elsewhere.
5. SHYST keeps the existing local user ID and all related rows untouched. The existing local admin flag remains the authority for SHYST admin access. CRASHOUT claims never grant SHYST admin rights.
6. If the mapping already exists and matches, the operation is idempotent. If either identity is already mapped to a different player, fail closed and send the case to an explicit recovery path. Never merge based on email, handle, display name, or matching provider usernames.

This is a one-time proof-based migration, not the old one-time-token link UX. The player does not lose their SHYST account or history.

## Normal sign-in after transition

- SHYST redirects to CRASHOUT OIDC.
- Worker validates the ID token and resolves `(game_key=shyst, crashout_user_id=sub)` through the destination identity resolver.
- If a mapping exists, SHYST issues its normal local session for that existing player.
- If no mapping exists, a new SHYST player may be provisioned only after successful CRASHOUT authentication. This creates a new local player; it must never guess or attach an old player by email/username.
- Existing SHYST password, Discord, and Telegram sign-in remain available during a staged migration. They are not silently removed or invalidated.

## Security and operational requirements

- OAuth client is confidential; client secret stays in Worker secrets. No OAuth secret or adapter credential reaches browser code.
- Authorization Code + PKCE (S256), state, nonce, exact redirect URI, short transaction TTL, one-time transaction consumption, and replay protection are mandatory.
- Use OIDC discovery; pin the expected issuer and client ID. Validate JWT signature using the advertised JWKS and allow only the configured asymmetric algorithms. Do not trust decoded JWT claims without signature validation.
- Request only `openid` unless a future feature has a documented need for more scopes. Email/profile are not needed for identity mapping.
- Resolver/claim endpoints are server-to-server, destination-scoped, and return no email or profile data.
- Adapter credentials authenticate the SHYST Worker to CRASHOUT's private destination endpoint; they are not the old user-facing linking mechanism.
- Do not deploy or enable production OIDC until the CRASHOUT OAuth client, signing keys/JWKS, consent UI, custom access-token hook, callback allowlist, and staging end-to-end tests are verified.
- Do not change the existing SHYST D1 player rows, tournament records, or production auth configuration during this implementation PR.
