import { describe, expect, it } from "vitest";
import { splitStatements } from "./statements";
import { ftsQuery } from "./repository";

describe("splitStatements", () => {
  it("splits plain statements", () => {
    expect(splitStatements("CREATE TABLE a (id TEXT); CREATE TABLE b (id TEXT);")).toEqual([
      "CREATE TABLE a (id TEXT)",
      "CREATE TABLE b (id TEXT)",
    ]);
  });

  it("ignores a trailing statement without a semicolon", () => {
    expect(splitStatements("SELECT 1")).toEqual(["SELECT 1"]);
  });

  it("drops empty statements from stray semicolons", () => {
    expect(splitStatements(";;SELECT 1;;")).toEqual(["SELECT 1"]);
  });

  it("keeps a trigger body intact", () => {
    const sql = `
      CREATE TRIGGER blocks_ai AFTER INSERT ON blocks BEGIN
        INSERT INTO blocks_fts(rowid, title) VALUES (new.rowid, new.title);
      END;
      CREATE INDEX idx_a ON blocks(id);
    `;
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("CREATE TRIGGER");
    expect(statements[0]).toContain("END");
    expect(statements[1]).toBe("CREATE INDEX idx_a ON blocks(id)");
  });

  it("keeps a trigger body with several inner statements intact", () => {
    const sql = `
      CREATE TRIGGER blocks_au AFTER UPDATE ON blocks BEGIN
        INSERT INTO blocks_fts(blocks_fts, rowid) VALUES ('delete', old.rowid);
        INSERT INTO blocks_fts(rowid, title) VALUES (new.rowid, new.title);
      END;
    `;
    expect(splitStatements(sql)).toHaveLength(1);
  });

  it("does not split on a semicolon inside a string literal", () => {
    const statements = splitStatements("INSERT INTO t (v) VALUES ('a;b'); SELECT 1;");
    expect(statements).toEqual(["INSERT INTO t (v) VALUES ('a;b')", "SELECT 1"]);
  });

  it("handles an escaped quote inside a string literal", () => {
    const statements = splitStatements("INSERT INTO t (v) VALUES ('it''s; fine'); SELECT 1;");
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("it''s; fine");
  });

  it("strips line comments without swallowing the next statement", () => {
    const sql = `
      -- a comment with a ; semicolon
      SELECT 1;
      SELECT 2; -- trailing
    `;
    expect(splitStatements(sql)).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("strips block comments", () => {
    expect(splitStatements("/* drop ; this */ SELECT 1;")).toEqual(["SELECT 1"]);
  });

  it("does not treat BEGIN inside an identifier as a block opener", () => {
    expect(splitStatements("SELECT beginning FROM t; SELECT 2;")).toHaveLength(2);
  });
});

describe("ftsQuery", () => {
  it("quotes each token, prefixing only the last so results narrow as you type", () => {
    expect(ftsQuery("ship the renderer")).toBe('"ship" "the" "renderer"*');
  });

  it("is null for input with nothing searchable in it", () => {
    expect(ftsQuery("")).toBeNull();
    expect(ftsQuery("   ")).toBeNull();
    expect(ftsQuery("!!! ???")).toBeNull();
  });

  /* Every one of these is a thrown SQLite error if it reaches MATCH raw, and
     the palette sends a partial query on every keystroke. */
  it("defuses FTS5 operators rather than passing them through", () => {
    expect(ftsQuery('a "quote')).toBe('"a" "quote"*');
    expect(ftsQuery("foo(")).toBe('"foo"*');
    expect(ftsQuery("a OR b")).toBe('"a" "or" "b"*');
    expect(ftsQuery("a NEAR/2 b")).toBe('"a" "near" "2" "b"*');
    expect(ftsQuery("col:value")).toBe('"col" "value"*');
    expect(ftsQuery("-minus ^caret *star")).toBe('"minus" "caret" "star"*');
  });

  it("keeps letters and digits from any script", () => {
    expect(ftsQuery("réunion 2026")).toBe('"réunion" "2026"*');
  });
});
