import { GRACE_MS, normalizeCode, type ClientMsg, type Envelope, type Messages, type PeerInfo, type Role, type ServerMsg } from './protocol';

/** a connection to the relay; swap the implementation (WebSocket now, WebRTC later) without touching the games */
export interface Transport {
  open(): Promise<void>;
  send(msg: ClientMsg): void;
  close(): void;
  onmessage: (m: ServerMsg) => void;
  onclose: () => void;
}

export class WebSocketTransport implements Transport {
  onmessage: (m: ServerMsg) => void = () => {};
  onclose: () => void = () => {};
  private ws?: WebSocket;

  constructor(private url: string) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('could not reach the relay'));
      ws.onmessage = (e) => {
        try { this.onmessage(JSON.parse(String(e.data))); } catch { /* ignore a bad frame */ }
      };
      ws.onclose = () => this.onclose();
    });
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws?.close();
  }
}

/** solo: no room. hosting: room open, waiting. linked: someone is here. dropped: the link is down, trying to come back. */
export type LinkState = 'solo' | 'hosting' | 'linked' | 'dropped';

export interface LinkOptions {
  role: Role;
  name: string;
  graceMs?: number;
  retryMs?: number;
}

/**
 * One game's side of a co-op room. Starts solo, and goes back to solo whenever the link ends,
 * so a game never depends on the other one being there.
 */
export class Link {
  state: LinkState = 'solo';
  code: string | null = null;
  me: PeerInfo | null = null;
  peers: PeerInfo[] = [];
  /** last failure, for the lobby to show */
  error: string | null = null;

  private stateHandlers: ((s: LinkState) => void)[] = [];
  private msgHandlers: ((e: Envelope) => void)[] = [];
  private transport: Transport | null = null;
  private pending: { resolve: (m: ServerMsg) => void } | null = null;
  private seq = 0;
  private isHost = false;
  private everLinked = false;
  private leaving = false;
  private lostAt: number | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private grace: number;
  private retry: number;

  constructor(private make: () => Transport, private opts: LinkOptions) {
    this.grace = opts.graceMs ?? GRACE_MS;
    this.retry = opts.retryMs ?? 2000;
  }

  onState(fn: (s: LinkState) => void): void { this.stateHandlers.push(fn); }
  onMessage(fn: (e: Envelope) => void): void { this.msgHandlers.push(fn); }

  /** open a room; resolves with its code */
  async host(): Promise<string> {
    const r = await this.start({ k: 'host', role: this.opts.role, name: this.opts.name });
    if (r.k !== 'hosted') throw new Error(this.fail(r));
    this.isHost = true;
    this.code = r.code;
    this.me = r.me;
    this.peers = [r.me];
    this.refresh();
    return r.code;
  }

  async join(code: string): Promise<void> {
    const r = await this.start({ k: 'join', code: normalizeCode(code), role: this.opts.role, name: this.opts.name });
    if (r.k !== 'joined') throw new Error(this.fail(r));
    this.isHost = false;
    this.code = r.code;
    this.me = r.me;
    this.peers = r.peers;
    this.refresh();
  }

  send<K extends keyof Messages>(type: K, body: Messages[K]): void {
    if (this.state === 'solo') return;
    this.transport?.send({ k: 'env', type, body, seq: ++this.seq });
  }

  leave(): void {
    this.leaving = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.transport?.send({ k: 'leave' });
    this.transport?.close();
    this.transport = null;
    this.reset();
    this.leaving = false;
  }

  private reset(): void {
    this.code = null;
    this.me = null;
    this.peers = [];
    this.lostAt = null;
    this.everLinked = false;
    this.isHost = false;
    this.setState('solo');
  }

  private fail(r: ServerMsg): string {
    this.error = r.k === 'error' ? (r.reason === 'no-room' ? 'No room with that code' : r.reason === 'full' ? 'That room is full' : 'Could not join') : 'Could not reach the relay';
    this.transport?.close();
    this.transport = null;
    return this.error;
  }

  private async start(first: ClientMsg): Promise<ServerMsg> {
    this.error = null;
    if (this.transport) this.leave();
    const t = this.make();
    this.transport = t;
    t.onmessage = (m) => this.receive(m);
    t.onclose = () => this.closed(t);
    try {
      await t.open();
    } catch {
      this.transport = null;
      return { k: 'error', reason: 'bad-message' };
    }
    const reply = new Promise<ServerMsg>((resolve) => { this.pending = { resolve }; });
    t.send(first);
    return reply;
  }

  private receive(m: ServerMsg): void {
    if (this.pending && (m.k === 'hosted' || m.k === 'joined' || m.k === 'error')) {
      const p = this.pending;
      this.pending = null;
      p.resolve(m);
      return;
    }
    switch (m.k) {
      case 'env':
        for (const h of this.msgHandlers) h(m.env);
        return;
      case 'peer': {
        const i = this.peers.findIndex((p) => p.id === m.peer.id);
        if (m.ev === 'leave') { if (i >= 0) this.peers.splice(i, 1); }
        else if (i >= 0) this.peers[i] = m.peer;
        else this.peers.push(m.peer);
        this.refresh();
        return;
      }
      default:
    }
  }

  /** work out the state from who is in the room */
  private refresh(): void {
    if (!this.code || !this.me) return this.setState('solo');
    if (this.lostAt !== null) return this.setState('dropped');
    const others = this.peers.filter((p) => p.id !== this.me!.id);
    if (others.some((p) => p.online)) {
      this.everLinked = true;
      return this.setState('linked');
    }
    if (others.length) return this.setState('dropped');
    // alone in the room: a host that never had company keeps waiting, anyone else ends the link
    if (this.isHost && !this.everLinked) return this.setState('hosting');
    this.leave();
  }

  /** our own connection went away: try to get back into the same seat until the grace period ends */
  private closed(t: Transport): void {
    if (this.leaving || t !== this.transport) return;
    this.transport = null;
    if (!this.code) return;
    this.lostAt = Date.now();
    this.refresh();
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    this.retryTimer = setTimeout(() => void this.tryRejoin(), this.retry);
  }

  private async tryRejoin(): Promise<void> {
    if (!this.code || !this.me || this.lostAt === null) return;
    if (Date.now() - this.lostAt > this.grace) return this.leave();
    const code = this.code;
    const me = this.me;
    const r = await this.start({ k: 'join', code, role: me.role, name: me.name, peer: me.id });
    if (r.k === 'joined') {
      this.me = r.me;
      this.peers = r.peers;
      this.lostAt = null;
      this.refresh();
    } else if (r.k === 'error' && r.reason === 'no-room') {
      this.leave();
    } else if (this.code) {
      this.scheduleRetry();
    }
  }

  private setState(s: LinkState): void {
    if (s === this.state) return;
    this.state = s;
    for (const h of this.stateHandlers) h(s);
  }
}
