/**
 * Builds the control-panel webview HTML. The UI is generated from the preset
 * schema sent in the `init` message; controls post `valueChanged` on every
 * input and `commit`/`reset`/`fullRender` on button clicks. Groups and
 * subgroups in the schema drive the visual structure.
 */
import * as vscode from "vscode";

export function panelHtml(webview: vscode.Webview, nonce: string): string {
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `frame-src http://127.0.0.1:* http://localhost:*`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  :root { --tw-row-h: 28px; }
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); font-size: 13px;
    color: var(--vscode-foreground); margin: 0; padding: 0; }

  /* Sticky action bar */
  .toolbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center;
    gap: 6px; padding: 10px 14px;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    border-bottom: 1px solid var(--vscode-panel-border);
    backdrop-filter: blur(2px); }
  .toolbar .spacer { flex: 1; }
  button { font-family: inherit; font-size: 12px; border: none; border-radius: 4px;
    padding: 5px 11px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
  button.primary { background: var(--vscode-button-background);
    color: var(--vscode-button-foreground); }
  button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button.ghost { background: transparent; color: var(--vscode-foreground); opacity: .8; }
  button.ghost:hover { background: var(--vscode-toolbar-hoverBackground,
    var(--vscode-list-hoverBackground)); opacity: 1; }
  button:disabled { opacity: .4; cursor: default; }

  #status { font-size: 11.5px; padding: 6px 14px 0; min-height: 14px;
    color: var(--vscode-descriptionForeground); }
  #status.error { color: var(--vscode-errorForeground); }

  .content { padding: 6px 14px 28px; }

  /* Groups */
  details.group { margin-top: 10px; }
  details.group > summary { list-style: none; cursor: pointer; user-select: none;
    display: flex; align-items: center; gap: 6px; padding: 6px 2px;
    font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
    color: var(--vscode-foreground); opacity: .75;
    border-bottom: 1px solid var(--vscode-panel-border); }
  details.group > summary::-webkit-details-marker { display: none; }
  details.group > summary .chev { transition: transform .12s ease; opacity: .6; font-size: 9px; }
  details.group:not([open]) > summary .chev { transform: rotate(-90deg); }
  details.group > summary .count { margin-left: auto; font-weight: 600; opacity: .6;
    font-size: 10px; letter-spacing: 0; }
  details.group > summary .count.dirty { color: var(--vscode-charts-orange, #e2a03f); opacity: 1; }

  .subgroup { font-size: 10px; font-weight: 600; letter-spacing: .04em;
    text-transform: uppercase; color: var(--vscode-descriptionForeground);
    margin: 10px 0 3px 2px; opacity: .65; }

  /* Rows */
  .row { display: flex; align-items: center; gap: 10px; min-height: var(--tw-row-h);
    padding: 3px 6px; border-radius: 5px; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row .label { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row.modified .label { font-weight: 600; }
  .row .dot { width: 6px; height: 6px; border-radius: 50%; flex: none;
    background: var(--vscode-charts-orange, #e2a03f); visibility: hidden; }
  .row.modified .dot { visibility: visible; }
  .badge { font-size: 8.5px; line-height: 1; padding: 2px 5px; border-radius: 8px;
    letter-spacing: .04em; text-transform: uppercase; flex: none;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); opacity: .8; }

  .control { display: flex; align-items: center; gap: 8px; flex: none;
    width: 168px; justify-content: flex-end; }
  input[type=range] { flex: 1; min-width: 0; height: 18px; cursor: pointer;
    accent-color: var(--vscode-button-background); }
  .val { font-variant-numeric: tabular-nums; font-size: 11px;
    color: var(--vscode-descriptionForeground); width: 52px; text-align: right; }

  input[type=color] { -webkit-appearance: none; appearance: none; width: 26px; height: 20px;
    padding: 0; border: 1px solid var(--vscode-panel-border); border-radius: 4px;
    background: none; cursor: pointer; flex: none; }
  input[type=color]::-webkit-color-swatch-wrapper { padding: 2px; }
  input[type=color]::-webkit-color-swatch { border: none; border-radius: 3px; }
  .hex { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px;
    text-transform: uppercase; color: var(--vscode-descriptionForeground);
    width: 70px; text-align: left; }

  select { width: 100%; font-family: inherit; font-size: 12px; padding: 3px 6px;
    border-radius: 4px; background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border); cursor: pointer; }
</style>
</head>
<body>
  <div class="toolbar">
    <button id="commit" class="primary" disabled>Commit to custom.scss</button>
    <span class="spacer"></span>
    <button id="reset" class="ghost" title="Revert to on-disk values">Reset</button>
    <button id="fullRender" class="ghost" title="Run a full quarto render">Full render</button>
  </div>
  <div id="status"></div>
  <div class="content"><div id="controls"></div></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const controls = document.getElementById("controls");
    const statusEl = document.getElementById("status");
    const commitBtn = document.getElementById("commit");

    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }

    function setStatus(text, kind) {
      statusEl.textContent = text || "";
      statusEl.className = kind === "error" ? "error" : "";
    }

    function build(schema, values) {
      controls.innerHTML = "";
      const order = [];
      const byGroup = {};
      for (const p of schema.presets) {
        if (!byGroup[p.group]) { byGroup[p.group] = {}; order.push(p.group); }
        const sub = p.subgroup || "";
        (byGroup[p.group][sub] ||= []).push(p);
      }
      for (const group of order) {
        const details = el("details", "group");
        details.open = true;
        const summary = el("summary");
        summary.appendChild(el("span", "chev", "▼"));
        summary.appendChild(el("span", "gname", group));
        const count = el("span", "count");
        count.dataset.group = group;
        summary.appendChild(count);
        details.appendChild(summary);

        const subs = byGroup[group];
        for (const sk of Object.keys(subs)) {
          if (sk) details.appendChild(el("div", "subgroup", sk));
          for (const p of subs[sk]) details.appendChild(rowFor(p, values[p.id]));
        }
        controls.appendChild(details);
      }
    }

    function rowFor(p, value) {
      if (value === undefined) value = p.default;
      const row = el("div", "row");
      row.dataset.id = p.id;
      row.dataset.group = p.group;

      const label = el("div", "label");
      label.appendChild(el("span", "dot"));
      label.appendChild(el("span", null, p.label));
      if (p.cssVar) {
        const b = el("span", "badge", "instant");
        b.title = "Updates instantly (no recompile)";
        label.appendChild(b);
      }
      row.appendChild(label);

      const ctl = el("div", "control");
      if (p.widget === "slider") {
        const input = el("input"); input.type = "range";
        input.min = p.min; input.max = p.max; input.step = p.step;
        input.value = parseFloat(value);
        const valEl = el("span", "val", fmt(value, p.unit));
        input.addEventListener("input", () => {
          const v = parseFloat(input.value);
          valEl.textContent = fmt(v, p.unit);
          send(p.id, p.unit ? v + p.unit : v);
        });
        ctl.appendChild(input); ctl.appendChild(valEl);
      } else if (p.widget === "color") {
        const input = el("input"); input.type = "color"; input.value = toHex(value);
        const hex = el("span", "hex", input.value);
        input.addEventListener("input", () => { hex.textContent = input.value; send(p.id, input.value); });
        ctl.appendChild(hex); ctl.appendChild(input);
      } else if (p.widget === "select") {
        const input = el("select");
        for (const opt of p.options || []) {
          const o = el("option", null, prettyOption(opt)); o.value = opt;
          if (opt === value) o.selected = true;
          input.appendChild(o);
        }
        input.addEventListener("change", () => send(p.id, input.value));
        ctl.appendChild(input);
      }
      row.appendChild(ctl);
      return row;
    }

    function fmt(v, unit) { return (typeof v === "number" ? v : parseFloat(v)) + (unit || ""); }
    function toHex(v) { return (typeof v === "string" && v[0] === "#") ? v.slice(0, 7) : "#000000"; }
    function prettyOption(o) {
      // Show only the first family name for font stacks; keep short values as-is.
      const first = String(o).split(",")[0].replace(/['"]/g, "").trim();
      return first.length && first.length < String(o).length ? first : String(o);
    }

    function send(id, value) { vscode.postMessage({ type: "valueChanged", id, value }); }

    function applyDirty(ids) {
      const set = new Set(ids);
      const perGroup = {};
      for (const row of controls.querySelectorAll(".row")) {
        const on = set.has(row.dataset.id);
        row.classList.toggle("modified", on);
        if (on) perGroup[row.dataset.group] = (perGroup[row.dataset.group] || 0) + 1;
      }
      for (const c of controls.querySelectorAll(".count")) {
        const n = perGroup[c.dataset.group] || 0;
        c.textContent = n ? n + " changed" : "";
        c.classList.toggle("dirty", n > 0);
      }
      const total = ids.length;
      commitBtn.disabled = total === 0;
      commitBtn.textContent = total === 0
        ? "Commit to custom.scss"
        : "Commit " + total + " change" + (total === 1 ? "" : "s");
    }

    commitBtn.onclick = () => vscode.postMessage({ type: "commit" });
    document.getElementById("reset").onclick = () => vscode.postMessage({ type: "reset" });
    document.getElementById("fullRender").onclick = () => vscode.postMessage({ type: "fullRender" });

    window.addEventListener("message", (e) => {
      const msg = e.data;
      if (msg.type === "init") { window.__schema = msg.schema; build(msg.schema, msg.values); applyDirty([]); }
      else if (msg.type === "values") build(window.__schema, msg.values);
      else if (msg.type === "status") setStatus(msg.text, msg.kind);
      else if (msg.type === "dirty") applyDirty(msg.ids);
    });

    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
}
