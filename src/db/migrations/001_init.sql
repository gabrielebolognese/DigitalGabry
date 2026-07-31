-- DigitalGabry, initial schema. SPEC sections 6 and 8.4.
--
-- Every identifier is a UUIDv7 string, every timestamp is integer milliseconds
-- since the Unix epoch in UTC, and nothing is ever hard deleted. The seed rows
-- carry fixed identifiers so a second device derives the same rows rather than
-- inventing conflicting ones.

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- Holds a category key from SPEC 3.2, not a literal colour. Keeping hex out
  -- of the database is what keeps tokens.css the only place colours exist.
  color       TEXT NOT NULL,
  archived    INTEGER NOT NULL DEFAULT 0,
  sort_order  REAL NOT NULL DEFAULT 0,
  created_utc INTEGER NOT NULL,
  updated_utc INTEGER NOT NULL,
  deleted_utc INTEGER,
  hlc         TEXT NOT NULL,
  device_id   TEXT NOT NULL
);

CREATE TABLE blocks (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  start_utc     INTEGER,
  end_utc       INTEGER,
  tz            TEXT NOT NULL DEFAULT 'Europe/Rome',
  all_day       INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'open',
  category      TEXT NOT NULL DEFAULT 'build',
  project_id    TEXT REFERENCES projects(id),
  parent_id     TEXT REFERENCES blocks(id),
  rrule         TEXT,
  recurrence_parent_id TEXT REFERENCES blocks(id),
  is_exception  INTEGER NOT NULL DEFAULT 0,
  payload       TEXT NOT NULL DEFAULT '{}',
  sort_order    REAL NOT NULL DEFAULT 0,
  created_utc   INTEGER NOT NULL,
  updated_utc   INTEGER NOT NULL,
  completed_utc INTEGER,
  deleted_utc   INTEGER,
  hlc           TEXT NOT NULL,
  device_id     TEXT NOT NULL
);

CREATE INDEX idx_blocks_range ON blocks(start_utc, end_utc) WHERE deleted_utc IS NULL;
CREATE INDEX idx_blocks_status ON blocks(status) WHERE deleted_utc IS NULL;
CREATE INDEX idx_blocks_project ON blocks(project_id) WHERE deleted_utc IS NULL;

CREATE TABLE tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  created_utc INTEGER NOT NULL,
  deleted_utc INTEGER,
  hlc         TEXT NOT NULL,
  device_id   TEXT NOT NULL
);

CREATE TABLE block_tags (
  block_id TEXT NOT NULL REFERENCES blocks(id),
  tag_id   TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (block_id, tag_id)
);

CREATE INDEX idx_block_tags_tag ON block_tags(tag_id);

-- Recurrence is materialised into this table over a rolling window and never
-- expanded at query time. SPEC 6.2.
CREATE TABLE occurrences (
  id            TEXT PRIMARY KEY,
  block_id      TEXT NOT NULL REFERENCES blocks(id),
  start_utc     INTEGER NOT NULL,
  end_utc       INTEGER NOT NULL,
  generated_utc INTEGER NOT NULL
);

CREATE INDEX idx_occ_range ON occurrences(start_utc, end_utc);
CREATE INDEX idx_occ_block ON occurrences(block_id);

-- One row per changed field, not per changed row. Row level logging loses one
-- of two concurrent edits to different fields of the same record. SPEC 6.3.
CREATE TABLE ops (
  id          TEXT PRIMARY KEY,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  field       TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  hlc         TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  created_utc INTEGER NOT NULL,
  synced      INTEGER NOT NULL DEFAULT 0,
  undone      INTEGER NOT NULL DEFAULT 0,
  batch       TEXT NOT NULL
);

CREATE INDEX idx_ops_unsynced ON ops(synced, hlc);
CREATE INDEX idx_ops_entity ON ops(entity, entity_id);
CREATE INDEX idx_ops_batch ON ops(batch);

-- Empty in v1. Present from migration 001 because retrofitting them later is
-- expensive and having them now costs nothing. SPEC 6.4.
CREATE TABLE devices (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  platform      TEXT NOT NULL,
  last_seen_utc INTEGER NOT NULL
);

CREATE TABLE sync_state (
  device_id      TEXT PRIMARY KEY,
  last_acked_hlc TEXT,
  last_sync_utc  INTEGER
);

CREATE TABLE activity_types (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL,
  category    TEXT NOT NULL,
  weight      REAL NOT NULL,
  daily_cap   INTEGER NOT NULL DEFAULT 999,
  unit        TEXT NOT NULL DEFAULT 'count',
  archived    INTEGER NOT NULL DEFAULT 0,
  sort_order  REAL NOT NULL DEFAULT 0,
  created_utc INTEGER NOT NULL,
  updated_utc INTEGER NOT NULL,
  deleted_utc INTEGER,
  hlc         TEXT NOT NULL,
  device_id   TEXT NOT NULL
);

CREATE TABLE activity_log (
  id               TEXT PRIMARY KEY,
  activity_type_id TEXT NOT NULL REFERENCES activity_types(id),
  local_date       TEXT NOT NULL,
  count            REAL NOT NULL DEFAULT 1,
  source           TEXT NOT NULL DEFAULT 'manual',
  block_id         TEXT REFERENCES blocks(id),
  note             TEXT,
  created_utc      INTEGER NOT NULL,
  updated_utc      INTEGER NOT NULL,
  deleted_utc      INTEGER,
  hlc              TEXT NOT NULL,
  device_id        TEXT NOT NULL
);

CREATE INDEX idx_activity_date ON activity_log(local_date) WHERE deleted_utc IS NULL;
CREATE INDEX idx_activity_block ON activity_log(block_id);

-- A cache, never a source of truth. Always reproducible from activity_log by a
-- pure function. SPEC 8.4.
CREATE TABLE momentum_daily (
  local_date   TEXT PRIMARY KEY,
  raw_score    REAL NOT NULL,
  multiplier   REAL NOT NULL,
  momentum     REAL NOT NULL,
  streak       INTEGER NOT NULL,
  computed_utc INTEGER NOT NULL
);

-- Full text search over blocks, kept in step by triggers. SPEC 6.5.
CREATE VIRTUAL TABLE blocks_fts USING fts5(
  title,
  description,
  content='blocks',
  content_rowid='rowid'
);

CREATE TRIGGER blocks_fts_ai AFTER INSERT ON blocks BEGIN
  INSERT INTO blocks_fts(rowid, title, description)
  VALUES (new.rowid, new.title, new.description);
END;

CREATE TRIGGER blocks_fts_ad AFTER DELETE ON blocks BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
END;

CREATE TRIGGER blocks_fts_au AFTER UPDATE ON blocks BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
  INSERT INTO blocks_fts(rowid, title, description)
  VALUES (new.rowid, new.title, new.description);
END;

-- Seeds. SPEC does not define a default project set, so these mirror the four
-- worlds named in the category comments of SPEC 3.2.
INSERT INTO projects (id, name, color, sort_order, created_utc, updated_utc, hlc, device_id) VALUES
  ('019fb80d-a796-71ae-baef-49778fb3ce61', 'FlashFX',  'build',    0, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00000:seed', 'seed'),
  ('019fb80d-a797-756c-bd40-d3a089ca5372', 'Content',  'content',  1, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00001:seed', 'seed'),
  ('019fb80d-a798-756c-b46d-55d3e4b4d835', 'School',   'admin',    2, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00002:seed', 'seed'),
  ('019fb80d-a798-756c-b46d-59e087ab5bb3', 'Personal', 'personal', 3, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00003:seed', 'seed');

-- The eighteen default activity types from SPEC 8.5, weights and caps exactly
-- as tabled there. All user editable afterwards.
INSERT INTO activity_types (id, name, icon, category, weight, daily_cap, sort_order, created_utc, updated_utc, hlc, device_id) VALUES
  ('019fb80d-a798-756c-b46d-5cb347a96c28', 'X reply',                       'x',         'content',   1,  20,  0, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00010:seed', 'seed'),
  ('019fb80d-a798-756c-b46d-625c09f87d04', 'X post',                        'x',         'content',   3,  10,  1, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00011:seed', 'seed'),
  ('019fb80d-a798-756c-b46d-6663c6f4b544', 'LinkedIn comment',              'linkedin',  'content',   2,  15,  2, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00012:seed', 'seed'),
  ('019fb80d-a799-7317-8811-4cfbee96745d', 'LinkedIn post',                 'linkedin',  'content',   8,   5,  3, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00013:seed', 'seed'),
  ('019fb80d-a799-7317-8811-515d4425f0cb', 'Instagram story',               'instagram', 'content',   3,  10,  4, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00014:seed', 'seed'),
  ('019fb80d-a799-7317-8811-56ca9cbde0e6', 'Instagram reel',                'instagram', 'content',  12,   5,  5, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00015:seed', 'seed'),
  ('019fb80d-a799-7317-8811-59fa306ddc61', 'TikTok post',                   'tiktok',    'content',  10,   5,  6, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00016:seed', 'seed'),
  ('019fb80d-a799-7317-8811-5e36d283b979', 'YouTube short',                 'youtube',   'content',  20,   5,  7, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00017:seed', 'seed'),
  ('019fb80d-a799-7317-8811-631ae1cdbfc5', 'YouTube long form',             'youtube',   'content',  45,   3,  8, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00018:seed', 'seed'),
  ('019fb80d-a79a-77e8-a8de-79a02a3d6b98', 'Blog or Render Journal article','pen-line',  'content',  30,   3,  9, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00019:seed', 'seed'),
  ('019fb80d-a79a-77e8-a8de-7ca43963c785', 'GitHub commit',                 'github',    'build',     2,  10, 10, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00020:seed', 'seed'),
  ('019fb80d-a79a-77e8-a8de-80a2571080a9', 'Feature shipped',               'package',   'build',    25,   5, 11, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00021:seed', 'seed'),
  ('019fb80d-a79a-77e8-a8de-84d8563312f1', 'App or product launched',       'rocket',    'build',   100,   2, 12, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00022:seed', 'seed'),
  ('019fb80d-a79a-77e8-a8de-88bceb353658', 'Bug fixed',                     'bug',       'build',     3,  10, 13, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00023:seed', 'seed'),
  ('019fb80d-a79a-77e8-a8de-8f39c5857c06', 'Cold outreach or DM',           'send',      'admin',     2,  20, 14, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00024:seed', 'seed'),
  ('019fb80d-a79a-77e8-a8de-918b28c36f4a', 'Resume or portfolio update',    'file-user', 'admin',    10,   2, 15, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00025:seed', 'seed'),
  ('019fb80d-a79a-77e8-a8de-950092c8a3ee', 'Study session',                 'book-open', 'admin',     5,   4, 16, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00026:seed', 'seed'),
  ('019fb80d-a79a-77e8-a8de-9a688947361c', 'Training session',              'dumbbell',  'personal',  5,   2, 17, strftime('%s','now') * 1000, strftime('%s','now') * 1000, '000000000000000:00027:seed', 'seed');
