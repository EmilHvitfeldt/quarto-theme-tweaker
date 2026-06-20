/**
 * Preview server: serves the rendered Quarto site and brokers live updates.
 *
 * This is the generalized, multi-variable successor to hotload_server.py. It
 * serves files from a render directory, injects the bundled bridge client into
 * served HTML, and pushes BridgeMessages to connected pages over a WebSocket.
 */
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { WebSocketServer, WebSocket } from "ws";
import type { BridgeMessage } from "../types";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

export class PreviewServer {
  private server?: http.Server;
  private wss?: WebSocketServer;
  private clients = new Set<WebSocket>();
  private port = 0;

  constructor(
    private rootDir: string,
    private indexFile: string,
    private bridgeScript: string
  ) {}

  /** Start listening; resolves with the chosen port. */
  start(requestedPort = 0): Promise<number> {
    this.server = http.createServer((req, res) => this.onRequest(req, res));
    this.wss = new WebSocketServer({ server: this.server, path: "/__tweaker" });
    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      ws.on("close", () => this.clients.delete(ws));
    });

    return new Promise((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(requestedPort, "127.0.0.1", () => {
        const addr = this.server!.address();
        this.port = typeof addr === "object" && addr ? addr.port : requestedPort;
        resolve(this.port);
      });
    });
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}/${this.indexFile}`;
  }

  /** Broadcast a bridge message to every connected preview page. */
  broadcast(msg: BridgeMessage) {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  dispose() {
    for (const ws of this.clients) ws.close();
    this.clients.clear();
    this.wss?.close();
    this.server?.close();
  }

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const reqPath = (req.url || "/").split("?")[0];
    const rel = decodeURIComponent(reqPath).replace(/^\/+/, "") || this.indexFile;
    const full = path.normalize(path.join(this.rootDir, rel));

    // Containment: never serve outside the render root.
    if (!full.startsWith(this.rootDir) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(full).toLowerCase();
    const ctype = MIME[ext] || "application/octet-stream";
    let body = fs.readFileSync(full);
    if (ctype === "text/html") {
      body = Buffer.from(this.injectBridge(body.toString("utf8")), "utf8");
    }
    res.writeHead(200, { "Content-Type": ctype, "Content-Length": body.length });
    res.end(body);
  }

  private injectBridge(html: string): string {
    const tag = `<script>\n${this.bridgeScript}\n</script>`;
    if (html.includes("</body>")) {
      return html.replace("</body>", tag + "</body>");
    }
    return html + tag;
  }
}
