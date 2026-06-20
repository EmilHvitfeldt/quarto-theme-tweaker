/**
 * Quarto Theme Tweaker — extension host.
 *
 * Renders the active Quarto document, serves it through our own preview server
 * (with the bridge client injected), and opens a control panel whose sliders
 * and color pickers drive live theme updates: instant CSS-var patches for
 * variables that map to a runtime custom property (fast path), and a debounced
 * dart-sass recompile for everything else (slow path). Commit writes the
 * working set back into custom.scss.
 */
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as cp from "child_process";
import { promisify } from "util";

import { PreviewServer } from "./host/previewServer";
import { readScssVars, upsertScssVars } from "./host/scssWriter";
import { buildSource, compile, quartoLoadPaths, SlowVar } from "./host/sassEngine";
import { panelHtml } from "./webview/panel";
import type { Preset, PresetSchema, PanelToHost, HostToPanel } from "./types";

const execFile = promisify(cp.execFile);

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("quartoThemeTweaker.open", () =>
      openTweaker(context).catch((err) =>
        vscode.window.showErrorMessage(`Theme Tweaker: ${err.message}`)
      )
    )
  );
}

export function deactivate() {}

interface Session {
  server: PreviewServer;
  schema: PresetSchema;
  presetById: Map<string, Preset>;
  customScss: string;
  working: Map<string, string | number>;
  /** Last on-disk/committed value per preset; working differs => modified. */
  baseline: Map<string, string | number>;
  qmdPath: string;
  loadPaths: string[];
  panel: vscode.WebviewPanel;
  preview: vscode.WebviewPanel;
  debounce?: NodeJS.Timeout;
  watcher?: vscode.FileSystemWatcher;
  /** Set while we write custom.scss ourselves, so the watcher ignores it. */
  selfWriting?: boolean;
}

async function openTweaker(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.document.fileName.endsWith(".qmd")) {
    throw new Error("Open a .qmd document first, then run the command.");
  }
  const qmdPath = editor.document.fileName;
  const docDir = path.dirname(qmdPath);
  const customScss = path.join(docDir, "custom.scss");

  const quarto = await locateQuarto();

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Quarto Theme Tweaker" },
    async (progress) => {
      progress.report({ message: "Rendering document..." });
      await execFile(quarto, ["render", path.basename(qmdPath)], { cwd: docDir });

      const { rootDir, indexFile } = locateRender(docDir, qmdPath);

      progress.report({ message: "Starting preview server..." });
      const bridgeScript = fs.readFileSync(
        path.join(context.extensionPath, "dist", "bridgeClient.js"),
        "utf8"
      );
      const server = new PreviewServer(rootDir, indexFile, bridgeScript);
      const cfgPort = vscode.workspace
        .getConfiguration("quartoThemeTweaker")
        .get<number>("previewPort", 0);
      await server.start(cfgPort);

      const format = detectFormat(qmdPath);
      const schema = loadSchema(context, format);
      const presetById = new Map(schema.presets.map((p) => [p.id, p]));

      // Seed working values from custom.scss, falling back to preset defaults.
      const onDisk = readScssVars(customScss);
      const working = new Map<string, string | number>();
      for (const p of schema.presets) {
        const bare = p.sassVar.replace(/^\$/, "");
        working.set(p.id, onDisk[bare] ?? p.default);
      }

      const external =
        vscode.workspace
          .getConfiguration("quartoThemeTweaker")
          .get<string>("preview", "internal") === "external";

      const preview = vscode.window.createWebviewPanel(
        "quartoThemeTweakerPreview",
        "Theme Preview",
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      if (external) {
        preview.webview.html = externalPreviewHtml(server.url);
        vscode.env.openExternal(vscode.Uri.parse(server.url));
      } else {
        preview.webview.html = previewIframeHtml(server.url);
      }

      const panel = vscode.window.createWebviewPanel(
        "quartoThemeTweaker",
        "Theme Tweaker",
        vscode.ViewColumn.Two,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      panel.webview.html = panelHtml(panel.webview, makeNonce());

      const session: Session = {
        server, schema, presetById, customScss, working,
        baseline: new Map(working), qmdPath,
        loadPaths: quartoLoadPaths(quarto), panel, preview,
      };

      panel.webview.onDidReceiveMessage(
        (msg: PanelToHost) => handleMessage(session, msg, quarto, docDir, indexFile),
        undefined,
        context.subscriptions
      );

      // Phase 3: reload the working set if custom.scss is edited by hand.
      session.watcher = vscode.workspace.createFileSystemWatcher(customScss);
      const onExternalEdit = () => {
        if (session.selfWriting) return;
        reloadFromDisk(session);
        post(session.panel, { type: "status", text: "Reloaded custom.scss (edited on disk)." });
      };
      session.watcher.onDidChange(onExternalEdit);
      session.watcher.onDidCreate(onExternalEdit);

      const dispose = () => {
        server.dispose();
        session.watcher?.dispose();
        if (session.debounce) clearTimeout(session.debounce);
      };
      panel.onDidDispose(dispose);
      preview.onDidDispose(() => panel.dispose());
    }
  );
}

function handleMessage(
  session: Session,
  msg: PanelToHost,
  quarto: string,
  docDir: string,
  indexFile: string
) {
  switch (msg.type) {
    case "ready":
      post(session.panel, {
        type: "init",
        schema: session.schema,
        values: Object.fromEntries(session.working),
        previewUrl: session.server.url,
      });
      break;

    case "valueChanged": {
      const preset = session.presetById.get(msg.id);
      if (!preset) return;
      session.working.set(msg.id, msg.value);
      if (preset.cssVar) {
        // Fast path: push a live CSS-var patch (<16ms, no compile).
        session.server.broadcast({
          type: "setCssVar",
          selector: preset.applyScope || ":root",
          name: preset.cssVar,
          value: String(msg.value),
        });
      } else {
        // Slow path: debounce, then recompile and hot-swap the stylesheet.
        scheduleRecompile(session);
      }
      postDirty(session);
      break;
    }

    case "commit":
      commit(session);
      break;

    case "reset":
      reset(session);
      break;

    case "fullRender":
      fullRender(session, quarto, docDir, indexFile);
      break;
  }
}

function scheduleRecompile(session: Session) {
  if (session.debounce) clearTimeout(session.debounce);
  const ms = vscode.workspace
    .getConfiguration("quartoThemeTweaker")
    .get<number>("debounceMs", 150);
  session.debounce = setTimeout(() => recompile(session), ms);
}

function recompile(session: Session) {
  const overrides: SlowVar[] = [];
  for (const [id, value] of session.working) {
    const p = session.presetById.get(id);
    if (p && !p.cssVar) overrides.push({ sassVar: p.sassVar, value: String(value) });
  }
  try {
    const css = compile(buildSource(session.customScss, overrides), session.loadPaths);
    session.server.broadcast({ type: "replaceStylesheet", css });
    post(session.panel, { type: "status", text: "Recompiled (approximate preview)." });
  } catch (err: any) {
    post(session.panel, { type: "status", text: `Sass error: ${err.message}`, kind: "error" });
  }
}

async function commit(session: Session) {
  // Only write variables that actually changed from the baseline.
  const changed = modifiedIds(session);
  if (changed.length === 0) {
    post(session.panel, { type: "status", text: "No changes to commit." });
    return;
  }

  const vars: Record<string, string> = {};
  for (const id of changed) {
    const p = session.presetById.get(id);
    if (p) vars[p.sassVar] = String(session.working.get(id));
  }
  const next = upsertScssVars(session.customScss, vars);

  const doc = await vscode.workspace.openTextDocument({ language: "scss", content: next });
  await vscode.window.showTextDocument(doc, { preview: true });
  const choice = await vscode.window.showInformationMessage(
    `Write ${changed.length} changed variable${changed.length === 1 ? "" : "s"} to ${path.basename(session.customScss)}?`,
    { modal: true },
    "Write"
  );
  if (choice === "Write") {
    session.selfWriting = true;
    fs.writeFileSync(session.customScss, next, "utf8");
    // Clear the flag after the watcher's debounce window has elapsed.
    setTimeout(() => (session.selfWriting = false), 500);
    // Committed values become the new baseline; nothing is "modified" now.
    session.baseline = new Map(session.working);
    postDirty(session);
    post(session.panel, { type: "status", text: `Committed ${changed.length} variable${changed.length === 1 ? "" : "s"} to custom.scss.` });
  }
}

/** Re-seed the working set + baseline from custom.scss (or preset defaults). */
function seedFromDisk(session: Session) {
  const onDisk = readScssVars(session.customScss);
  for (const p of session.schema.presets) {
    const bare = p.sassVar.replace(/^\$/, "");
    session.working.set(p.id, onDisk[bare] ?? p.default);
  }
  session.baseline = new Map(session.working);
}

/** Ids whose working value differs from the baseline (i.e. modified). */
function modifiedIds(session: Session): string[] {
  const out: string[] = [];
  for (const [id, value] of session.working) {
    if (String(value) !== String(session.baseline.get(id))) out.push(id);
  }
  return out;
}

/** Tell the panel which controls are currently modified. */
function postDirty(session: Session) {
  post(session.panel, { type: "dirty", ids: modifiedIds(session) });
}

function reset(session: Session) {
  seedFromDisk(session);
  // Reload the preview from disk state, then resend values to the panel.
  session.server.broadcast({ type: "reload" });
  post(session.panel, { type: "values", values: Object.fromEntries(session.working) });
  postDirty(session);
  post(session.panel, { type: "status", text: "Reset to on-disk values." });
}

/**
 * Phase 3: react to an external edit of custom.scss. Re-seed the working set,
 * push the current values to the live preview (fast-path patches + a slow-path
 * recompile), and resend values to the control panel, without a page reload.
 */
function reloadFromDisk(session: Session) {
  seedFromDisk(session);
  let needsRecompile = false;
  for (const [id, value] of session.working) {
    const p = session.presetById.get(id);
    if (!p) continue;
    if (p.cssVar) {
      session.server.broadcast({
        type: "setCssVar",
        selector: p.applyScope || ":root",
        name: p.cssVar,
        value: String(value),
      });
    } else {
      needsRecompile = true;
    }
  }
  if (needsRecompile) recompile(session);
  post(session.panel, { type: "values", values: Object.fromEntries(session.working) });
  postDirty(session);
}

async function fullRender(session: Session, quarto: string, docDir: string, indexFile: string) {
  post(session.panel, { type: "status", text: "Running full quarto render..." });
  try {
    await execFile(quarto, ["render", path.basename(session.qmdPath)], { cwd: docDir });
    session.server.broadcast({ type: "reload" });
    post(session.panel, { type: "status", text: "Full render complete." });
  } catch (err: any) {
    post(session.panel, { type: "status", text: `Render failed: ${err.message}`, kind: "error" });
  }
}

// --- helpers ---------------------------------------------------------------

function loadSchema(context: vscode.ExtensionContext, format: string): PresetSchema {
  const name = format === "revealjs" ? "quarto-revealjs.json" : "quarto-html.json";
  const file = path.join(context.extensionPath, "presets", name);
  return JSON.parse(fs.readFileSync(file, "utf8")) as PresetSchema;
}

/**
 * Detect the document's output format from its YAML front matter. Returns
 * "revealjs" for reveal.js decks, otherwise "html" (the default schema).
 */
function detectFormat(qmdPath: string): string {
  try {
    const text = fs.readFileSync(qmdPath, "utf8");
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    const head = (fm ? fm[1] : text).toLowerCase();
    if (/\brevealjs\b/.test(head)) return "revealjs";
  } catch {
    // fall through to default
  }
  return "html";
}

/** Find the rendered output dir + index file for a given qmd. */
function locateRender(docDir: string, qmdPath: string): { rootDir: string; indexFile: string } {
  const base = path.basename(qmdPath, ".qmd");
  const candidates = [
    { rootDir: docDir, indexFile: `${base}.html` },
    { rootDir: path.join(docDir, "_site"), indexFile: `${base}.html` },
    { rootDir: path.join(docDir, "_site"), indexFile: "index.html" },
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c.rootDir, c.indexFile))) return c;
  }
  throw new Error(`Could not find rendered HTML for ${base}.qmd. Try rendering manually first.`);
}

/** Locate the quarto binary via the Quarto extension API, falling back to PATH. */
async function locateQuarto(): Promise<string> {
  try {
    const ext = vscode.extensions.getExtension("quarto.quarto");
    if (ext) {
      const api = ext.isActive ? ext.exports : await ext.activate();
      if (api && typeof api.getQuartoPath === "function") {
        const p = api.getQuartoPath();
        if (p) return resolveQuartoBinary(p);
      }
    }
  } catch {
    // fall through to PATH
  }
  return "quarto";
}

/** The Quarto extension may hand back the bin directory; resolve to the binary. */
function resolveQuartoBinary(p: string): string {
  try {
    if (fs.statSync(p).isDirectory()) {
      const exe = path.join(p, process.platform === "win32" ? "quarto.exe" : "quarto");
      if (fs.existsSync(exe)) return exe;
    }
  } catch {
    // fall through
  }
  return p;
}

function previewIframeHtml(url: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8" />
<style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100vh;}</style>
</head><body><iframe src="${url}" sandbox="allow-scripts allow-same-origin"></iframe></body></html>`;
}

function externalPreviewHtml(url: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8" />
<style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px;}
a{color:var(--vscode-textLink-foreground);}</style></head>
<body><h3>Preview opened in your browser</h3>
<p>Live updates are pushed to the browser tab at:</p>
<p><a href="${url}">${url}</a></p>
<p>Switch <code>quartoThemeTweaker.preview</code> to <code>internal</code> to embed it here instead.</p>
</body></html>`;
}

function post(panel: vscode.WebviewPanel, msg: HostToPanel) {
  panel.webview.postMessage(msg);
}

function makeNonce(): string {
  let s = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
