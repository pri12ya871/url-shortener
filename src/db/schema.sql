CREATE TABLE IF NOT EXISTS links (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT        NOT NULL,
  target_url  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE
);

-- The unique index is what makes collision handling correct: two concurrent
-- writers that generate the same random code cannot both succeed, so the
-- insert (ON CONFLICT DO NOTHING) is the collision check.
CREATE UNIQUE INDEX IF NOT EXISTS links_code_key ON links (code);
CREATE INDEX IF NOT EXISTS links_created_at_idx ON links (created_at DESC);

CREATE TABLE IF NOT EXISTS clicks (
  id          BIGSERIAL PRIMARY KEY,
  link_id     BIGINT      NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  clicked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  visitor_id  TEXT,           -- salted hash of IP + UA; no raw IP is stored
  referrer    TEXT,
  user_agent  TEXT,
  device      TEXT,
  browser     TEXT,
  country     TEXT
);

-- Every analytics query filters by link and orders/buckets by time.
CREATE INDEX IF NOT EXISTS clicks_link_time_idx ON clicks (link_id, clicked_at DESC);
