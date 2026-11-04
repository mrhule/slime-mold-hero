import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { originAllowed } from './hosts';
import { parseClientMsg } from './protocol';
import { Relay, type RelayConn } from './relay';
import { RELAY_PATH } from './relay-path';

interface Upgradable {
  on(event: 'upgrade', fn: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown;
  on(event: 'close', fn: () => void): unknown;
}

const MAX_CLIENTS = 64;

/** Attach the relay to an HTTP server so one `vite --host` serves the games and the LAN link together. */
function attach(http: Upgradable): void {
  // a frame bigger than any message we send is refused before it is read into memory
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16_384 });
  const relay = new Relay();
  const alive = new WeakMap<WebSocket, boolean>();

  http.on('upgrade', (req, socket, head) => {
    if (req.url?.split('?')[0] !== RELAY_PATH) return; // leave Vite's own hot reload socket alone
    // a web page from elsewhere on the internet must not be able to reach a relay running on this computer
    if (!originAllowed(req.headers.origin, req.headers.host)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    if (wss.clients.size >= MAX_CLIENTS) { socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn: RelayConn = {
        send: (m) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
        close: () => ws.close(),
      };
      alive.set(ws, true);
      ws.on('pong', () => alive.set(ws, true));
      ws.on('message', (data) => {
        const msg = parseClientMsg(String(data));
        if (msg) relay.handle(conn, msg);
        else conn.send({ k: 'error', reason: 'bad-message' });
      });
      ws.on('close', () => relay.disconnect(conn));
      ws.on('error', () => ws.terminate());
    });
  });

  // phones that sleep or leave wifi never say goodbye, so ping and cut off the silent ones
  const timer = setInterval(() => {
    relay.sweep();
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue; }
      alive.set(ws, false);
      ws.ping();
    }
  }, 10_000);
  timer.unref();
  http.on('close', () => { clearInterval(timer); wss.close(); });
}

export function linkRelay(): Plugin {
  return {
    name: 'slime-link-relay',
    configureServer(server) { if (server.httpServer) attach(server.httpServer); },
    configurePreviewServer(server) { attach(server.httpServer); },
  };
}
