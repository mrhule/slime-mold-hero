import { GRACE_MS, PROTOCOL_VERSION, makeRoomCode, type ClientMsg, type PeerInfo, type ServerMsg } from './protocol';

/** one connection, whatever carries it (a WebSocket in the dev server, an in-memory pipe in tests) */
export interface RelayConn {
  send(msg: ServerMsg): void;
  close(): void;
}

interface Member {
  info: PeerInfo;
  conn: RelayConn | null;
  droppedAt: number | null;
}

interface Room {
  code: string;
  members: Map<string, Member>;
}

export interface RelayOptions {
  graceMs?: number;
  maxPeers?: number;
  /** most rooms open at once; a host asking for more is refused */
  maxRooms?: number;
  /** wrong room codes one connection may try before it is cut off */
  maxBadJoins?: number;
  rng?: () => number;
  now?: () => number;
}

/**
 * Rooms by code and fan-out of messages. No game logic. A peer whose connection drops keeps its seat for
 * the grace period so it can rejoin; `sweep()` removes the ones that did not come back.
 */
export class Relay {
  readonly rooms = new Map<string, Room>();
  private conns = new Map<RelayConn, { room: string; peer: string }>();
  private nextId = 1;
  private grace: number;
  private maxPeers: number;
  private maxRooms: number;
  private maxBadJoins: number;
  /** failed joins per connection, so the 4 letter codes cannot be guessed at speed */
  private badJoins = new Map<RelayConn, number>();
  private rng: () => number;
  private now: () => number;

  constructor(opts: RelayOptions = {}) {
    this.grace = opts.graceMs ?? GRACE_MS;
    this.maxPeers = opts.maxPeers ?? 8;
    this.maxRooms = opts.maxRooms ?? 64;
    this.maxBadJoins = opts.maxBadJoins ?? 8;
    this.rng = opts.rng ?? Math.random;
    this.now = opts.now ?? Date.now;
  }

  handle(conn: RelayConn, msg: ClientMsg): void {
    switch (msg.k) {
      case 'ping':
        conn.send({ k: 'pong' });
        return;
      case 'host': {
        if (this.conns.has(conn)) return conn.send({ k: 'error', reason: 'busy' });
        if (this.rooms.size >= this.maxRooms) return conn.send({ k: 'error', reason: 'busy' });
        let code = makeRoomCode(this.rng);
        for (let i = 0; this.rooms.has(code) && i < 50; i++) code = makeRoomCode(this.rng);
        if (this.rooms.has(code)) return conn.send({ k: 'error', reason: 'busy' }); // never take over a room that exists
        const room: Room = { code, members: new Map() };
        this.rooms.set(code, room);
        const me = this.seat(room, conn, msg.role, msg.name);
        conn.send({ k: 'hosted', code, me });
        return;
      }
      case 'join': {
        const room = this.rooms.get(msg.code);
        if (!room) {
          const n = (this.badJoins.get(conn) ?? 0) + 1;
          this.badJoins.set(conn, n);
          conn.send({ k: 'error', reason: n >= this.maxBadJoins ? 'busy' : 'no-room' });
          if (n >= this.maxBadJoins) conn.close();
          return;
        }
        const old = msg.peer ? room.members.get(msg.peer) : undefined;
        if (old && old.droppedAt !== null) {
          // the same peer coming back inside the grace period
          old.conn = conn;
          old.droppedAt = null;
          old.info.online = true;
          this.conns.set(conn, { room: room.code, peer: old.info.id });
          conn.send({ k: 'joined', code: room.code, me: old.info, peers: this.peers(room) });
          this.broadcast(room, { k: 'peer', ev: 'rejoin', peer: old.info }, old.info.id);
          return;
        }
        if (this.conns.has(conn)) return conn.send({ k: 'error', reason: 'busy' });
        if (room.members.size >= this.maxPeers) return conn.send({ k: 'error', reason: 'full' });
        const me = this.seat(room, conn, msg.role, msg.name);
        conn.send({ k: 'joined', code: room.code, me, peers: this.peers(room) });
        this.broadcast(room, { k: 'peer', ev: 'join', peer: me }, me.id);
        return;
      }
      case 'env': {
        const at = this.conns.get(conn);
        const room = at && this.rooms.get(at.room);
        const from = room?.members.get(at!.peer);
        if (!room || !from) return;
        this.broadcast(room, { k: 'env', env: { v: PROTOCOL_VERSION, room: room.code, from: from.info.id, role: from.info.role, seq: msg.seq, type: msg.type, body: msg.body } }, from.info.id);
        return;
      }
      case 'leave':
        this.remove(conn);
        return;
    }
  }

  /** the connection went away: keep the seat for the grace period */
  disconnect(conn: RelayConn): void {
    this.badJoins.delete(conn);
    const at = this.conns.get(conn);
    if (!at) return;
    this.conns.delete(conn);
    const room = this.rooms.get(at.room);
    const m = room?.members.get(at.peer);
    if (!room || !m || m.conn !== conn) return;
    m.conn = null;
    m.droppedAt = this.now();
    m.info.online = false;
    this.broadcast(room, { k: 'peer', ev: 'drop', peer: m.info }, m.info.id);
  }

  /** remove peers that stayed away longer than the grace period, and empty rooms */
  sweep(): void {
    for (const room of [...this.rooms.values()]) {
      for (const m of [...room.members.values()]) {
        if (m.droppedAt !== null && this.now() - m.droppedAt > this.grace) this.drop(room, m);
      }
      if (room.members.size === 0) this.rooms.delete(room.code);
    }
  }

  private remove(conn: RelayConn): void {
    const at = this.conns.get(conn);
    if (!at) return;
    this.conns.delete(conn);
    const room = this.rooms.get(at.room);
    const m = room?.members.get(at.peer);
    if (room && m) {
      this.drop(room, m);
      if (room.members.size === 0) this.rooms.delete(room.code);
    }
  }

  private drop(room: Room, m: Member): void {
    room.members.delete(m.info.id);
    this.broadcast(room, { k: 'peer', ev: 'leave', peer: m.info }, m.info.id);
  }

  private seat(room: Room, conn: RelayConn, role: PeerInfo['role'], name: string): PeerInfo {
    const info: PeerInfo = { id: `${role}-${this.nextId++}-${Math.floor(this.rng() * 1e6).toString(36)}`, role, name: name || role, online: true };
    room.members.set(info.id, { info, conn, droppedAt: null });
    this.conns.set(conn, { room: room.code, peer: info.id });
    return info;
  }

  private peers(room: Room): PeerInfo[] {
    return [...room.members.values()].map((m) => m.info);
  }

  private broadcast(room: Room, msg: ServerMsg, except: string): void {
    for (const m of room.members.values()) if (m.info.id !== except && m.conn) m.conn.send(msg);
  }
}
