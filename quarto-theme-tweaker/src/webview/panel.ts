/**
 * Builds the control-panel webview HTML. The UI is generated from the preset
 * schema sent in the `init` message; controls post `valueChanged` on every
 * input and `commit`/`reset`/`fullRender` on button clicks.
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
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    padding: 12px; margin: 0; }
  h3 { margin: 16px 0 6px; font-size: 11px; text-transform: uppercase;
    letter-spacing: .06em; opacity: .7; }
  .row { display: grid; grid-template-columns: 1fr auto; align-items: center;
    gap: 8px; margin: 6px 0; }
  .row label { font-size: 13px; }
  .val { font-variant-numeric: tabular-nums; opacity: .8; font-size: 12px; }
  .ctl { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; }
  input[type=range] { flex: 1; }
  .badge { font-size: 9px; padding: 1px 5px; border-radius: 6px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .toolbar { position: sticky; top: 0; background: var(--vscode-editor-background);
    padding: 8px 0; display: flex; gap: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; padding: 5px 12px; border-radius: 3px; cursor: pointer; }
  button.secondary { background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground); }
  #status { font-size: 12px; padding: 6px 0; min-height: 16px; opacity: .85; }
  #status.error { color: var(--vscode-errorForeground); }
  button:disabled { opacity: .5; cursor: default; }
  .modified > .row label::before { content: "● "; color: var(--vscode-charts-orange,
    var(--vscode-gitDecoration-modifiedResourceForeground, #e2a03f)); font-size: 10px; }
  .modified > .row label { font-weight: 600; }
</style>
</head>
<body>
  <div class="toolbar">
    <button id="commit">Commit to custom.scss</button>
    <button id="reset" class="secondary">Reset</button>
    <button id="fullRender" class="secondary">Full render</button>
  </div>
  <div id="status"></div>
  <div id="controls"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const controls = document.getElementById("controls");
    const statusEl = document.getElementById("status");

    function setStatus(text, kind) {
      statusEl.textContent = text || "";
      statusEl.className = kind === "error" ? "error" : "";
    }

    function build(schema, values) {
      controls.innerHTML = "";
      const groups = {};
      for (const p of schema.presets) (groups[p.group] ||= []).push(p);
      for (const group of Object.keys(groups)) {
        const h = document.createElement("h3");
        h.textContent = group;
        controls.appendChild(h);
        for (const p of groups[group]) controls.appendChild(rowFor(p, values[p.id]));
      }
    }

    function rowFor(p, value) {
      if (value === undefined) value = p.default;
      const wrap = document.createElement("div");
      wrap.dataset.id = p.id;
      const row = document.createElement("div");
      row.className = "row";
      const label = document.createElement("label");
      label.textContent = p.label;
      const valEl = document.createElement("span");
      valEl.className = "val";
      row.appendChild(label);
      if (p.cssVar) {
        const b = document.createElement("span");
        b.className = "badge";
        b.textContent = "instant";
        row.appendChild(b);
      }
      wrap.appendChild(row);

      const ctl = document.createElement("div");
      ctl.className = "ctl";
      let input;
      if (p.widget === "slider") {
        input = document.createElement("input");
        input.type = "range";
        input.min = p.min; input.max = p.max; input.step = p.step;
        input.value = parseFloat(value);
        valEl.textContent = value + (p.unit || "");
        input.addEventListener("input", () => {
          const v = parseFloat(input.value);
          valEl.textContent = v + (p.unit || "");
          send(p.id, p.unit ? v + p.unit : v);
        });
        ctl.appendChild(input);
        ctl.appendChild(valEl);
      } else if (p.widget === "color") {
        input = document.createElement("input");
        input.type = "color";
        input.value = toHex(value);
        valEl.textContent = input.value;
        input.addEventListener("input", () => {
          valEl.textContent = input.value;
          send(p.id, input.value);
        });
        ctl.appendChild(input);
        ctl.appendChild(valEl);
      } else if (p.widget === "select") {
        input = document.createElement("select");
        for (const opt of p.options || []) {
          const o = document.createElement("option");
          o.value = opt; o.textContent = opt;
          if (opt === value) o.selected = true;
          input.appendChild(o);
        }
        input.addEventListener("change", () => send(p.id, input.value));
        ctl.appendChild(input);
      }
      wrap.appendChild(ctl);
      return wrap;
    }

    function toHex(v) {
      if (typeof v === "string" && v[0] === "#") return v.slice(0, 7);
      return "#000000";
    }

    function send(id, value) {
      vscode.postMessage({ type: "valueChanged", id, value });
    }

    const commitBtn = document.getElementById("commit");
    commitBtn.onclick = () => vscode.postMessage({ type: "commit" });
    document.getElementById("reset").onclick = () => vscode.postMessage({ type: "reset" });
    document.getElementById("fullRender").onclick = () => vscode.postMessage({ type: "fullRender" });

    function applyDirty(ids) {
      const set = new Set(ids);
      for (const el of controls.children) {
        if (el.dataset && el.dataset.id) el.classList.toggle("modified", set.has(el.dataset.id));
      }
      const n = ids.length;
      commitBtn.disabled = n === 0;
      commitBtn.textContent = n === 0 ? "Commit to custom.scss" : "Commit " + n + " change" + (n === 1 ? "" : "s");
    }

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
