#!/usr/bin/env python3
"""Hot-load the h2 font size into an already-rendered Quarto document.

Serves the rendered files in this directory and watches `custom.scss` for the
`$h2-font-size` value. When it changes, the new size is pushed to any open page
over Server-Sent Events and applied to <h2> at runtime, with no Quarto re-render.

Usage:
    python3 hotload_server.py            # serves on http://localhost:8000
    python3 hotload_server.py 8080 index.html

Then open the printed URL, and edit `$h2-font-size` in custom.scss and save.
"""

import os
import re
import sys
import time
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
SCSS = os.path.join(ROOT, "custom.scss")
# Revealjs heading-size variable (falls back to the Bootstrap one for HTML docs).
H2_RE = re.compile(r"\$(?:presentation-h2-font-size|h2-font-size)\s*:\s*([^;]+?)\s*;")

# Injected into served HTML; listens for pushes and overrides the h2 size live.
CLIENT_JS = """
(function () {
  var style = document.createElement("style");
  style.id = "__hotload_h2";
  document.head.appendChild(style);
  function apply(size) {
    // Revealjs sizes headings via the --r-heading2-size CSS variable; setting it
    // on :root updates the slides live. The plain h2 rule covers non-reveal HTML.
    style.textContent =
      ":root { --r-heading2-size: " + size + " !important; }\n" +
      "h2, .h2 { font-size: " + size + " !important; }";
  }
  var es = new EventSource("/__events");
  es.onmessage = function (e) {
    var data = JSON.parse(e.data);
    if (data.h2) apply(data.h2);
  };
  es.onerror = function () { console.warn("[hotload] disconnected, retrying..."); };
})();
"""


def read_h2_size():
    """Return the current $h2-font-size value from custom.scss, or None."""
    try:
        with open(SCSS, "r") as f:
            m = H2_RE.search(f.read())
            return m.group(1).strip() if m else None
    except FileNotFoundError:
        return None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # quiet

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == "/__hotload.js":
            body = CLIENT_JS.encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/__events":
            self._serve_events()
            return

        self._serve_file(path)

    def _serve_events(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        last = object()  # sentinel so the first read always sends
        try:
            while True:
                size = read_h2_size()
                if size != last:
                    last = size
                    payload = json.dumps({"h2": size})
                    self.wfile.write(("data: " + payload + "\n\n").encode())
                    self.wfile.flush()
                    print(f"[hotload] pushed h2 font-size: {size}")
                time.sleep(0.4)
        except (BrokenPipeError, ConnectionResetError):
            return

    def _serve_file(self, path):
        rel = path.lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(ROOT, rel))
        if not full.startswith(ROOT) or not os.path.isfile(full):
            self.send_error(404)
            return

        with open(full, "rb") as f:
            body = f.read()

        ctype = guess_type(full)
        if ctype == "text/html":
            body = inject_client(body)

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def inject_client(html_bytes):
    tag = b'<script src="/__hotload.js"></script>'
    if b"</body>" in html_bytes:
        return html_bytes.replace(b"</body>", tag + b"</body>", 1)
    return html_bytes + tag


def guess_type(path):
    ext = os.path.splitext(path)[1].lower()
    return {
        ".html": "text/html",
        ".css": "text/css",
        ".js": "application/javascript",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
    }.get(ext, "application/octet-stream")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    page = sys.argv[2] if len(sys.argv) > 2 else "index.html"
    server = ThreadingHTTPServer(("localhost", port), Handler)
    url = f"http://localhost:{port}/{page}"
    print(f"[hotload] serving {ROOT}")
    print(f"[hotload] open {url}")
    print(f"[hotload] watching $h2-font-size in {os.path.basename(SCSS)} (Ctrl-C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[hotload] stopped")


if __name__ == "__main__":
    main()
