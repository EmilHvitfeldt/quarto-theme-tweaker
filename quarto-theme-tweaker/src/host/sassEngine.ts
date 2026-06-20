/**
 * Slow-path Sass compile for variables without a runtime CSS-var mapping.
 *
 * v1 (per the plan) compiles only the user's custom.scss defaults plus the
 * current uncommitted overrides, into a small stylesheet that is hot-swapped
 * into the preview. It is an explicit high-fidelity approximation; the
 * canonical output still comes from `quarto render` after commit. Resolving the
 * full reveal/Bootstrap partial bundle is deferred (see plan Phase 2/4).
 */
import * as fs from "fs";
import * as path from "path";
import * as sass from "sass";

export interface SlowVar {
  sassVar: string; // includes leading $
  value: string;
}

/**
 * Build an in-memory SCSS source: the user's defaults with overrides spliced
 * in, then a thin set of rules mapping a few common vars to selectors so the
 * compiled output visibly affects the page even without the full framework.
 */
export function buildSource(customScssPath: string, overrides: SlowVar[]): string {
  const base = fs.existsSync(customScssPath) ? fs.readFileSync(customScssPath, "utf8") : "";
  // Strip the scss:defaults marker comment; we re-declare vars below.
  const stripped = base.replace(/\/\*--\s*scss:\w+\s*--\*\//g, "");

  const decls = overrides.map((o) => `${o.sassVar}: ${o.value} !default;`).join("\n");

  // Minimal rule layer so non-cssVar variables still show up live. These mirror
  // the most common Quarto/Bootstrap variable usages.
  const rules = `
${varRule("$code-block-bg", ".reveal pre, .reveal div.sourceCode", "background-color")}
${varRule("$code-block-border-color", ".reveal pre, .reveal div.sourceCode", "border-color")}
${varRule("$code-block-font-size", ".reveal pre code", "font-size")}
${varRule("$code-color", ".reveal code", "color")}
${varRule("$code-bg", ".reveal code", "background-color")}
${varRule("$text-muted", ".reveal .text-muted", "color")}
${varRule("$presentation-line-height", ".reveal", "line-height")}
${varRule("$presentation-slide-text-align", ".reveal .slides section", "text-align")}
${varRule("$border-color", ".reveal table th, .reveal table td", "border-color")}
`;

  return `@use "sass:meta";\n${decls}\n${stripped}\n${rules}`;
}

/** Emit a guarded rule only applied if the variable is actually defined. */
function varRule(name: string, selector: string, prop: string): string {
  const safe = name.replace(/^\$/, "");
  return `@if meta.variable-exists("${safe}") { ${selector} { ${prop}: ${name}; } }`;
}

/**
 * Compile a source string. `loadPaths` lets framework partials (Quarto's
 * bundled Bootstrap/reveal SCSS) resolve if the user's custom.scss imports
 * them; pass the discovered Quarto share directories.
 */
export function compile(source: string, loadPaths: string[] = []): string {
  const result = sass.compileString(source, {
    style: "expanded",
    loadPaths,
    quietDeps: true, // don't surface Bootstrap's own deprecation warnings
    logger: sass.Logger.silent,
  });
  return result.css;
}

/** Quarto's bundled SCSS directories, if the install can be located. */
export function quartoLoadPaths(quartoBinary: string): string[] {
  // <prefix>/bin/quarto -> <prefix>/share/formats/...
  const binDir = path.dirname(quartoBinary);
  const share = path.resolve(binDir, "..", "share");
  const dirs = [
    path.join(share, "formats", "html", "bootstrap"),
    path.join(share, "formats", "html", "bootstrap", "dist", "scss"),
    path.join(share, "formats", "revealjs", "themes"),
  ];
  return dirs.filter((d) => fs.existsSync(d));
}
