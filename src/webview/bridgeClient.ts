/**
 * Bridge client, injected into the served Quarto preview page.
 *
 * Generalizes the prototype's hot-load client (hotload_server.py): instead of
 * only patching --r-heading2-size, it applies arbitrary CSS-var patches (fast
 * path) and full recompiled stylesheets (slow path) pushed over a WebSocket.
 */
import type { BridgeMessage } from "../types";

(function () {
  const VAR_STYLE_ID = "__tweaker_vars";
  const SHEET_STYLE_ID = "__tweaker_sheet";

  // One managed <style> for live CSS-var overrides; values keyed by selector.
  const varState = new Map<string, Map<string, string>>();

  function ensureStyle(id: string): HTMLStyleElement {
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    return el;
  }

  function renderVars() {
    const el = ensureStyle(VAR_STYLE_ID);
    let css = "";
    for (const [selector, vars] of varState) {
      css += selector + " {\n";
      for (const [name, value] of vars) {
        css += "  " + name + ": " + value + " !important;\n";
      }
      css += "}\n";
    }
    el.textContent = css;
  }

  function setCssVar(selector: string, name: string, value: string) {
    let vars = varState.get(selector);
    if (!vars) {
      vars = new Map();
      varState.set(selector, vars);
    }
    vars.set(name, value);
    renderVars();
  }

  function replaceStylesheet(css: string) {
    ensureStyle(SHEET_STYLE_ID).textContent = css;
  }

  function handle(msg: BridgeMessage) {
    switch (msg.type) {
      case "setCssVar":
        setCssVar(msg.selector, msg.name, msg.value);
        break;
      case "replaceStylesheet":
        replaceStylesheet(msg.css);
        break;
      case "reload":
        location.reload();
        break;
    }
  }

  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(proto + "://" + location.host + "/__tweaker");
    ws.onmessage = (e) => {
      try {
        handle(JSON.parse(e.data));
      } catch (err) {
        console.warn("[tweaker] bad message", err);
      }
    };
    ws.onclose = () => {
      console.warn("[tweaker] disconnected, retrying in 1s...");
      setTimeout(connect, 1000);
    };
    ws.onerror = () => ws.close();
  }

  connect();
})();
