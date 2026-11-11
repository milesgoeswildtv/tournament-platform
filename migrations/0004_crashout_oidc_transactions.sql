-- Short-lived, server-side OIDC transactions for the CRASHOUT identity provider.
-- Legacy claims are started from an already-authenticated SHYST player session.
-- Normal SSO sign-in has no SHYST user until the verified subject is resolved.
-- The PKCE verifier is server-only; state and nonce are stored as hashes.
CREATE TABLE crashout_oidc_transactions (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  nonce_hash TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('legacy_claim', 'sign_in')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  CHECK (expires_at > created_at),
  CHECK ((purpose = 'legacy_claim' AND user_id IS NOT NULL)
      OR (purpose = 'sign_in' AND user_id IS NULL))
);

CREATE INDEX idx_crashout_oidc_transactions_expiry
  ON crashout_oidc_transactions(expires_at);

CREATE INDEX idx_crashout_oidc_transactions_user
  ON crashout_oidc_transactions(user_id, created_at)
  WHERE user_id IS NOT NULL;

CREATE TRIGGER crashout_oidc_transactions_no_reopen
BEFORE UPDATE ON crashout_oidc_transactions
WHEN OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'consumed OIDC transactions cannot be reopened');
END;
