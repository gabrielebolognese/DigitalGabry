/* Splits a migration file into individually executable statements.
 *
 * A naive split on ";" tears trigger bodies apart, because the statements
 * inside BEGIN ... END are themselves semicolon terminated, and the FTS5 sync
 * triggers in SPEC 6.5 are exactly that shape.
 *
 * Depth is tracked on the BEGIN and END keywords. That is correct for trigger
 * bodies and would be wrong for a CASE ... END expression at statement level;
 * no migration uses one, and the guard below keeps depth from going negative
 * if that ever changes.
 *
 * Pure, so it can be tested without a database or a Tauri runtime.
 */

const WORD = /[A-Za-z_]/;

function readWord(sql: string, start: number): string {
  let end = start;
  while (end < sql.length && WORD.test(sql[end])) end += 1;
  return sql.slice(start, end);
}

export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let depth = 0;
  let index = 0;

  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed !== "") statements.push(trimmed);
    current = "";
  };

  while (index < sql.length) {
    const char = sql[index];

    if (char === "-" && sql[index + 1] === "-") {
      const lineEnd = sql.indexOf("\n", index);
      index = lineEnd === -1 ? sql.length : lineEnd + 1;
      current += "\n";
      continue;
    }

    if (char === "/" && sql[index + 1] === "*") {
      const commentEnd = sql.indexOf("*/", index + 2);
      index = commentEnd === -1 ? sql.length : commentEnd + 2;
      continue;
    }

    if (char === "'") {
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === "'") {
          if (sql[end + 1] === "'") {
            end += 2;
            continue;
          }
          break;
        }
        end += 1;
      }
      current += sql.slice(index, Math.min(end + 1, sql.length));
      index = end + 1;
      continue;
    }

    if (WORD.test(char) && (index === 0 || !WORD.test(sql[index - 1]))) {
      const word = readWord(sql, index);
      const upper = word.toUpperCase();
      if (upper === "BEGIN") depth += 1;
      else if (upper === "END") depth = Math.max(0, depth - 1);
      current += word;
      index += word.length;
      continue;
    }

    if (char === ";" && depth === 0) {
      flush();
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  flush();
  return statements;
}
