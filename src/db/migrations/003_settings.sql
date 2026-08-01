-- SPEC 8.2 says the decay, the streak increment, the streak cap and the
-- streak threshold are "stored in settings and editable", but SPEC 6 defines
-- no settings table. This is that table.

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_utc INTEGER NOT NULL
);
