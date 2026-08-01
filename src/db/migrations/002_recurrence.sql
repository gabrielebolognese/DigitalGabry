-- Recurrence support. Phase 6.
--
-- An exception block's start_utc is its NEW time, so nothing in migration 001
-- can say WHICH generated occurrence it replaces. That is the iCalendar
-- RECURRENCE-ID, and without it a moved instance cannot be matched back to the
-- instant it overrides.

ALTER TABLE blocks ADD COLUMN recurrence_original_start_utc INTEGER;

CREATE INDEX idx_blocks_recurrence_parent
  ON blocks(recurrence_parent_id) WHERE deleted_utc IS NULL;

-- At most one live exception per instant of a series.
CREATE UNIQUE INDEX ux_blocks_exception
  ON blocks(recurrence_parent_id, recurrence_original_start_utc)
  WHERE is_exception <> 0 AND deleted_utc IS NULL;

-- is_exception is a three valued marker on the existing column, no migration
-- needed for the values themselves:
--   0  not an exception, a normal block or a series seed
--   1  override, this single occurrence was edited or moved
--   2  cancellation, this single occurrence was deleted
--
-- Deleting one occurrence is therefore an insert, which means undo tombstones
-- it and the occurrence regenerates by itself. No new op semantics, no hard
-- delete of user data.

-- Lets app start skip work. fingerprint is rrule|start_utc|end_utc|tz, so a
-- warm boot is one SELECT and zero writes.
CREATE TABLE recurrence_state (
  block_id         TEXT PRIMARY KEY REFERENCES blocks(id),
  window_start_utc INTEGER NOT NULL,
  window_end_utc   INTEGER NOT NULL,
  fingerprint      TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL,
  truncated        INTEGER NOT NULL DEFAULT 0,
  generated_utc    INTEGER NOT NULL
);
