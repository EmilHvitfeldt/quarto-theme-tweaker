/**
 * Read and write `$var: value;` lines in the user's custom.scss.
 *
 * Reads are used to seed initial control values; writes (commit) upsert lines
 * into the `scss:defaults` block with a tolerant, line-based edit that
 * preserves the user's hand-written content and comments.
 */
import * as fs from "fs";

const DEFAULTS_MARKER = "/*-- scss:defaults --*/";

/** Parse all top-level `$var: value;` assignments. Returns name (without $) -> value. */
export function readScssVars(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  const text = fs.readFileSync(file, "utf8");
  const re = /^\s*\$([A-Za-z0-9_-]+)\s*:\s*([^;]+?)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * Produce the new file contents with each `sassVar -> value` upserted into the
 * defaults block. `vars` keys include the leading `$`. Returns the new text;
 * the caller decides whether/how to write it (e.g. after a diff confirmation).
 */
export function upsertScssVars(file: string, vars: Record<string, string>): string {
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";

  if (!text.includes(DEFAULTS_MARKER)) {
    text = `${DEFAULTS_MARKER}\n` + text;
  }

  const lines = text.split("\n");
  const remaining = new Map(Object.entries(vars));

  // Replace existing assignments in place.
  for (let i = 0; i < lines.length; i++) {
    for (const [name, value] of remaining) {
      const bare = name.replace(/^\$/, "");
      const re = new RegExp(`^(\\s*)\\$${escapeRe(bare)}\\s*:\\s*[^;]+;`);
      if (re.test(lines[i])) {
        lines[i] = lines[i].replace(re, `$1$${bare}: ${value};`);
        remaining.delete(name);
      }
    }
  }

  if (remaining.size === 0) return lines.join("\n");

  // Append any new assignments right after the defaults marker.
  const idx = lines.findIndex((l) => l.includes(DEFAULTS_MARKER));
  const additions: string[] = [];
  for (const [name, value] of remaining) {
    additions.push(`$${name.replace(/^\$/, "")}: ${value};`);
  }
  lines.splice(idx + 1, 0, ...additions);
  return lines.join("\n");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
