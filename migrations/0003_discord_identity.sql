-- Discord as a second sign-in provider on the canonical SHYST player.
-- The Discord user id (a snowflake) is the key; usernames are display only.
ALTER TABLE users ADD COLUMN discord_id TEXT;
ALTER TABLE users ADD COLUMN discord_username TEXT;
CREATE UNIQUE INDEX idx_users_discord_id ON users(discord_id);

-- Short-lived, single-use tokens for browser auth flows (only hashes stored):
--   discord_state   OAuth state for one authorize round trip (user_id set when linking)
--   discord_pending a verified Discord identity with no SHYST player yet, awaiting
--                   the person's choice: create a new player, or sign in and link
--   session_ticket  hands a fresh session to the web app after the callback,
--                   so a session token never appears in a URL
CREATE TABLE auth_flows (
  token_hash  TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  user_id     TEXT,
  payload     TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX idx_auth_flows_kind ON auth_flows(kind, expires_at);
