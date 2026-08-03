-- Content surfaces. Spec2 section 1.4.
--
-- Numbered 004, not the 002 the specification names: 002_recurrence and
-- 003_settings already exist, and the runner picks migrations up by name sort.
--
-- One table for four platforms. The pipeline, the scheduling link and the
-- momentum logging are identical across all of them, so a table per platform
-- would buy nothing and cost four of every query.

CREATE TABLE content_items (
  id           TEXT PRIMARY KEY,
  platform     TEXT NOT NULL,          -- x | linkedin | instagram | youtube
  status       TEXT NOT NULL DEFAULT 'idea',
  title        TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  payload      TEXT NOT NULL DEFAULT '{}',
  block_id     TEXT REFERENCES blocks(id),
  project_id   TEXT REFERENCES projects(id),
  posted_utc   INTEGER,
  posted_url   TEXT,
  sort_order   REAL NOT NULL DEFAULT 0,
  created_utc  INTEGER NOT NULL,
  updated_utc  INTEGER NOT NULL,
  deleted_utc  INTEGER,
  hlc          TEXT NOT NULL,
  device_id    TEXT NOT NULL
);

CREATE INDEX idx_content_platform ON content_items(platform, status)
  WHERE deleted_utc IS NULL;
CREATE INDEX idx_content_updated ON content_items(updated_utc)
  WHERE deleted_utc IS NULL;

-- The item a block was scheduled for. Without this, completing a block would
-- have to scan every content row to find what it publishes.
CREATE INDEX idx_content_block ON content_items(block_id)
  WHERE deleted_utc IS NULL AND block_id IS NOT NULL;

-- Content addressed by hash. Importing the same image twice is a no-op, and
-- moving the vault is one setting rather than a rewrite of every row, because
-- `path` is relative to the vault root and never absolute. Invariant 11.
CREATE TABLE assets (
  id          TEXT PRIMARY KEY,
  path        TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  mime        TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER NOT NULL,
  origin      TEXT NOT NULL DEFAULT 'import',  -- import | generated | capture
  created_utc INTEGER NOT NULL,
  deleted_utc INTEGER,
  hlc         TEXT NOT NULL,
  device_id   TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_assets_sha ON assets(sha256) WHERE deleted_utc IS NULL;

CREATE TABLE content_assets (
  content_id TEXT NOT NULL REFERENCES content_items(id),
  asset_id   TEXT NOT NULL REFERENCES assets(id),
  role       TEXT NOT NULL DEFAULT 'primary',  -- primary | variant | reference
  sort_order REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (content_id, asset_id, role)
);

CREATE INDEX idx_content_assets_asset ON content_assets(asset_id);

-- Same shape as blocks_fts, kept in step by the same three triggers. Deleted
-- rows are filtered on read rather than removed from the index, matching how
-- blocks already behave.
CREATE VIRTUAL TABLE content_fts USING fts5(
  title,
  body,
  content='content_items',
  content_rowid='rowid'
);

CREATE TRIGGER content_fts_ai AFTER INSERT ON content_items BEGIN
  INSERT INTO content_fts(rowid, title, body)
  VALUES (new.rowid, new.title, new.body);
END;

CREATE TRIGGER content_fts_ad AFTER DELETE ON content_items BEGIN
  INSERT INTO content_fts(content_fts, rowid, title, body)
  VALUES ('delete', old.rowid, old.title, old.body);
END;

CREATE TRIGGER content_fts_au AFTER UPDATE ON content_items BEGIN
  INSERT INTO content_fts(content_fts, rowid, title, body)
  VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO content_fts(rowid, title, body)
  VALUES (new.rowid, new.title, new.body);
END;
