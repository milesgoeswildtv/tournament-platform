-- Short-lived, server-side OIDC transactions for the CRASHOUT identity provider.
-- The SHYST player is authenticated before a transition/claim is started.
-- PKCE verifier is server-only and is deleted when the transaction is consumed/expired.
CREATE TABLE crashout_oidc_transactions (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nonce_hash TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('legacy_claim', 'sign_in')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  CHECK (expires_at > created_at)
);

CREATE INDEX idx_crashout_oidc_transactions_expiry
  ON crashout_oidc_transactions(expires_at);

CREATE INDEX idx_crashout_oidc_transactions_user
  ON crashout_oidc_transactions(user_id, created_at);

-- Never allow a transaction to be reused or extended after it is consumed.
CREATE TRIGGER crashout_oidc_transactions_no_reopen
BEFORE UPDATE ON crashout_oidc_transactions
WHEN OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'consumed OIDC transactions cannot be reopened');
END;
