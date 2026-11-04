CREATE TABLE admin_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_by TEXT REFERENCES users(id),
  redeemed_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX idx_admin_keys_created ON admin_keys(created_by, created_at);
