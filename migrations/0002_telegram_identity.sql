-- One canonical player per person. Telegram is a linked sign-in method on that
-- player, never a second player.

-- A Telegram-only duplicate that held no history can be reconciled into the
-- player who proved ownership of both. The row is kept (never deleted) and
-- points at the canonical player.
ALTER TABLE users ADD COLUMN merged_into TEXT REFERENCES users(id);
ALTER TABLE users ADD COLUMN merged_at INTEGER;

-- Single-use, short-lived proof that the signed-in player asked to link.
-- Delivered to Telegram as /start link_<token> or startapp=link_<token>;
-- only the hash is stored.
CREATE TABLE telegram_link_tokens (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  used_at      INTEGER,
  used_by_telegram_id TEXT
);
CREATE INDEX idx_tg_link_user ON telegram_link_tokens(user_id, created_at);

-- Append-only record of every identity change: links, reconciliations, refusals.
CREATE TABLE identity_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,      -- TELEGRAM_LINKED | TELEGRAM_RECONCILED | TELEGRAM_LINK_REFUSED
  telegram_id   TEXT,
  other_user_id TEXT,               -- the duplicate that was reconciled, or the owner that blocked a link
  via           TEXT NOT NULL,      -- bot | miniapp | miniapp-session
  detail        TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_identity_events_user ON identity_events(user_id, id);
CREATE TRIGGER identity_events_no_update BEFORE UPDATE ON identity_events BEGIN SELECT RAISE(ABORT, 'identity_events is append-only'); END;
CREATE TRIGGER identity_events_no_delete BEFORE DELETE ON identity_events BEGIN SELECT RAISE(ABORT, 'identity_events is append-only'); END;
