-- Core schema. Times are epoch milliseconds. Money is integer cents.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,               -- internal id, e.g. u_ab12…
  tag           TEXT NOT NULL UNIQUE,           -- public player id shown in the UI, e.g. 7K3QX2
  handle        TEXT UNIQUE,                    -- login name (lowercase); NULL for Telegram-only accounts
  display_name  TEXT NOT NULL,
  password_hash TEXT,                           -- PBKDF2-SHA256, base64
  password_salt TEXT,
  telegram_id   TEXT UNIQUE,
  telegram_username TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,                 -- SHA-256 of the bearer token; the token itself is never stored
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE tournaments (
  id           TEXT PRIMARY KEY,
  sponsor_id   TEXT NOT NULL REFERENCES users(id),
  title        TEXT NOT NULL,
  status       TEXT NOT NULL,                   -- LOBBY | COUNTDOWN | RUNNING | FINISHED | CANCELED | ABANDONED
  visibility   TEXT NOT NULL DEFAULT 'PRIVATE',
  config_json  TEXT NOT NULL,
  config_hash  TEXT NOT NULL,
  sequence_json TEXT NOT NULL,                  -- full stage lineup (hidden from players when random)
  stage_count  INTEGER NOT NULL,
  current_stage INTEGER NOT NULL DEFAULT 0,
  player_count INTEGER NOT NULL DEFAULT 1,
  commitment_cents INTEGER NOT NULL,
  currency     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  started_at   INTEGER,
  finished_at  INTEGER,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_tournaments_status ON tournaments(status, visibility, created_at);
CREATE INDEX idx_tournaments_sponsor ON tournaments(sponsor_id, created_at);

-- Every configuration the sponsor saved, in order. Rows are never updated.
CREATE TABLE config_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  actor_id      TEXT NOT NULL,
  config_json   TEXT NOT NULL,
  config_hash   TEXT NOT NULL,
  reason        TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_config_history_t ON config_history(tournament_id, id);

CREATE TABLE invites (
  code          TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  max_uses      INTEGER NOT NULL,
  uses          INTEGER NOT NULL DEFAULT 0,
  revoked_at    INTEGER
);
CREATE INDEX idx_invites_t ON invites(tournament_id, created_at);

CREATE TABLE invite_redemptions (
  code          TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  tournament_id TEXT NOT NULL,
  redeemed_at   INTEGER NOT NULL,
  PRIMARY KEY (code, user_id)
);

CREATE TABLE participants (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  role          TEXT NOT NULL,                  -- HOST | PLAYER
  competes      INTEGER NOT NULL,
  eligible_from INTEGER NOT NULL,               -- first stage this player may compete in
  join_order    INTEGER NOT NULL,
  via_invite    TEXT,
  joined_at     INTEGER NOT NULL,
  left_at       INTEGER,
  PRIMARY KEY (tournament_id, user_id)
);
CREATE INDEX idx_participants_user ON participants(user_id, joined_at);

-- Append-only audit log. Each tournament's events are numbered 1..n.
CREATE TABLE tournament_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  type          TEXT NOT NULL,
  actor_id      TEXT,
  payload_json  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (tournament_id, seq)
);
CREATE INDEX idx_events_type ON tournament_events(tournament_id, type);

CREATE TABLE submissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id TEXT NOT NULL,
  stage         INTEGER NOT NULL,
  round         INTEGER NOT NULL,
  user_id       TEXT NOT NULL,
  action_json   TEXT NOT NULL,
  accepted      INTEGER NOT NULL,
  reject_reason TEXT,
  received_at   INTEGER NOT NULL,
  event_seq     INTEGER NOT NULL,
  UNIQUE (tournament_id, event_seq)
);
CREATE INDEX idx_submissions_t ON submissions(tournament_id, stage, round);

CREATE TABLE stage_results (
  tournament_id TEXT NOT NULL,
  stage         INTEGER NOT NULL,
  game_id       TEXT NOT NULL,
  duration_ms   INTEGER NOT NULL,
  rounds        INTEGER NOT NULL,
  winners_json  TEXT NOT NULL,
  record_json   TEXT NOT NULL,
  finished_at   INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, stage)
);

CREATE TABLE eliminations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id TEXT NOT NULL,
  stage         INTEGER NOT NULL,
  round         INTEGER NOT NULL,
  user_id       TEXT NOT NULL,
  reason        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  event_seq     INTEGER NOT NULL,
  UNIQUE (tournament_id, event_seq, user_id)
);
CREATE INDEX idx_elim_t ON eliminations(tournament_id, stage);

CREATE TABLE standings (
  tournament_id TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  rank          INTEGER NOT NULL,
  stage_wins    INTEGER NOT NULL,
  outright_wins INTEGER NOT NULL,
  rounds_survived INTEGER NOT NULL,
  stages_played INTEGER NOT NULL,
  eliminations  INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, user_id)
);
CREATE INDEX idx_standings_user ON standings(user_id);

-- Prize commitments. Nothing here is a payment: status is COMMITTED_UNPAID or UNAWARDED.
CREATE TABLE allocations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id TEXT NOT NULL,
  kind          TEXT NOT NULL,
  ref           TEXT NOT NULL,
  label         TEXT NOT NULL,
  user_id       TEXT,
  amount_cents  INTEGER NOT NULL,
  currency      TEXT NOT NULL,
  status        TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  line          INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (tournament_id, line)
);
CREATE INDEX idx_alloc_t ON allocations(tournament_id);
CREATE INDEX idx_alloc_user ON allocations(user_id);

CREATE TABLE award_results (
  tournament_id TEXT NOT NULL,
  award_id      TEXT NOT NULL,
  criteria_json TEXT NOT NULL,
  winners_json  TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, award_id)
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  link       TEXT,
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);
CREATE INDEX idx_notifications_user ON notifications(user_id, id);

CREATE TABLE rate_limits (
  key        TEXT NOT NULL,
  window     INTEGER NOT NULL,
  count      INTEGER NOT NULL,
  PRIMARY KEY (key, window)
);

-- Immutability guards for audit tables.
CREATE TRIGGER events_no_update BEFORE UPDATE ON tournament_events BEGIN SELECT RAISE(ABORT, 'tournament_events is append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON tournament_events BEGIN SELECT RAISE(ABORT, 'tournament_events is append-only'); END;
CREATE TRIGGER submissions_no_update BEFORE UPDATE ON submissions BEGIN SELECT RAISE(ABORT, 'submissions are append-only'); END;
CREATE TRIGGER submissions_no_delete BEFORE DELETE ON submissions BEGIN SELECT RAISE(ABORT, 'submissions are append-only'); END;
CREATE TRIGGER config_history_no_update BEFORE UPDATE ON config_history BEGIN SELECT RAISE(ABORT, 'config_history is append-only'); END;
CREATE TRIGGER stage_results_no_update BEFORE UPDATE ON stage_results BEGIN SELECT RAISE(ABORT, 'stage_results are immutable'); END;
CREATE TRIGGER allocations_no_update BEFORE UPDATE ON allocations BEGIN SELECT RAISE(ABORT, 'allocations are immutable'); END;
CREATE TRIGGER eliminations_no_update BEFORE UPDATE ON eliminations BEGIN SELECT RAISE(ABORT, 'eliminations are immutable'); END;
