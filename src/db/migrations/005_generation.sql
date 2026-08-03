-- The generation layer. Spec1.1 section 10.
--
-- Numbered 005, not the 003 the specification names: 003_settings and
-- 004_content already exist, and the runner applies migrations by name sort.
--
-- Three sparse tables. A year of a busy schedule produces a few hundred
-- override rows, against the roughly 150,000 block rows that storing every
-- generated slot would have written. Slots are computed, never stored;
-- only deviations persist. Invariant 18.

CREATE TABLE rulesets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  sort_order  REAL NOT NULL DEFAULT 0,
  created_utc INTEGER NOT NULL,
  updated_utc INTEGER NOT NULL,
  deleted_utc INTEGER,
  hlc         TEXT NOT NULL,
  device_id   TEXT NOT NULL
);

-- Keyed on (id, version): a generator is a family of versions, and editing one
-- opens a new row rather than mutating the old. Generation selects the version
-- whose validity range contains the date being generated, so changing your
-- Monday schedule does not rewrite what last month looked like. Invariant 21.
CREATE TABLE generators (
  id           TEXT NOT NULL,
  version      INTEGER NOT NULL,
  ruleset_id   TEXT NOT NULL REFERENCES rulesets(id),
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'generator',  -- generator | modifier
  stage        TEXT,                               -- transform | filter | constrain | resolve
  enabled      INTEGER NOT NULL DEFAULT 1,
  layer        INTEGER NOT NULL DEFAULT 50,
  sort_order   REAL NOT NULL DEFAULT 0,
  valid_from   INTEGER,
  valid_to     INTEGER,
  timezone     TEXT NOT NULL DEFAULT 'Europe/Rome',
  emits        TEXT NOT NULL DEFAULT '{}',
  config       TEXT NOT NULL DEFAULT '{}',
  dst          TEXT,
  created_utc  INTEGER NOT NULL,
  updated_utc  INTEGER NOT NULL,
  deleted_utc  INTEGER,
  hlc          TEXT NOT NULL,
  device_id    TEXT NOT NULL,
  PRIMARY KEY (id, version)
);

CREATE INDEX idx_gen_active ON generators(ruleset_id, enabled, valid_from, valid_to)
  WHERE deleted_utc IS NULL;

CREATE INDEX idx_gen_family ON generators(id, version) WHERE deleted_utc IS NULL;

-- A persisted deviation on one slot. Keyed by the slot key, which is
-- (generator, local date, ordinal) and deliberately not the timestamp, so a
-- skip survives the rule's time being edited.
CREATE TABLE slot_overrides (
  slot_key        TEXT PRIMARY KEY,
  generator_id    TEXT NOT NULL,
  local_date      TEXT NOT NULL,
  ordinal         INTEGER NOT NULL,
  action          TEXT NOT NULL,        -- skip | move | pin | unskip
  moved_start_utc INTEGER,
  moved_end_utc   INTEGER,
  reason          TEXT,
  created_utc     INTEGER NOT NULL,
  updated_utc     INTEGER NOT NULL,
  deleted_utc     INTEGER,
  hlc             TEXT NOT NULL,
  device_id       TEXT NOT NULL
);

CREATE INDEX idx_override_date ON slot_overrides(local_date) WHERE deleted_utc IS NULL;
CREATE INDEX idx_override_generator ON slot_overrides(generator_id) WHERE deleted_utc IS NULL;

CREATE TABLE slot_bindings (
  slot_key     TEXT PRIMARY KEY,
  generator_id TEXT NOT NULL,
  content_id   TEXT REFERENCES content_items(id),
  block_id     TEXT REFERENCES blocks(id),
  bound_utc    INTEGER NOT NULL,
  created_utc  INTEGER NOT NULL,
  updated_utc  INTEGER NOT NULL,
  deleted_utc  INTEGER,
  hlc          TEXT NOT NULL,
  device_id    TEXT NOT NULL
);

CREATE INDEX idx_binding_content ON slot_bindings(content_id) WHERE deleted_utc IS NULL;
CREATE INDEX idx_binding_block ON slot_bindings(block_id) WHERE deleted_utc IS NULL;
CREATE INDEX idx_binding_generator ON slot_bindings(generator_id) WHERE deleted_utc IS NULL;
