import type { Transport } from './client';
import { MemoryTransport } from './memory';
import { parseClientMsg, type ClientMsg, type ServerMsg } from './protocol';
import { Relay, type RelayConn } from './relay';

/**
 * Serverless LAN link. One device (the host) runs the relay in its own page, and the other connects to it
 * over a WebRTC data channel. The two browsers swap a pair of text blobs by hand (copy and paste, or a QR code
 * later) instead of asking a signalling server, and no STUN server is used, so it only works on one network.
 * The games and the protocol do not change: the guest still talks `ClientMsg` and `ServerMsg` to a relay.
 */

/** just enough of an RTCDataChannel for the bridge, so tests can use a fake */
export interface Channel {
  readyState: string;
  send(data: string): void;
  close(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

export interface Pairing {
  v: 1;
  /** the room code a guest must join with; only in the host's offer */
  code?: string;
  desc: { type: 'offer' | 'answer'; sdp: string };
}

const PREFIX = 'SM1.';

const toB64 = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  w.write(bytes as BufferSource).then(() => w.close()).catch(() => {}); // a bad block fails on the read side below
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** turn a pairing into a short block of text that survives copy and paste */
export async function pack(p: Pairing): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(p));
  return PREFIX + toB64(await pipe(raw, new CompressionStream('deflate-raw')));
}

export async function unpack(text: string): Promise<Pairing> {
  const bad = new Error('That code is not valid. Copy the whole block.');
  const t = text.replace(/\s+/g, '');
  if (!t.startsWith(PREFIX)) throw bad;
  try {
    const raw = await pipe(fromB64(t.slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
    const p = JSON.parse(new TextDecoder().decode(raw)) as Pairing;
    if (p.v !== 1 || !p.desc || (p.desc.type !== 'offer' && p.desc.type !== 'answer') || typeof p.desc.sdp !== 'string') throw bad;
    return p;
  } catch {
    throw bad;
  }
}

/** wire one guest's data channel to the relay: the channel is that guest's connection */
export function bridge(relay: Relay, ch: Channel): RelayConn {
  const conn: RelayConn = {
    send: (m: ServerMsg) => { if (ch.readyState === 'open') ch.send(JSON.stringify(m)); },
    close: () => ch.close(),
  };
  ch.onmessage = (e) => {
    const msg = parseClientMsg(String(e.data));
    if (msg) relay.handle(conn, msg);
    else conn.send({ k: 'error', reason: 'bad-message' });
  };
  ch.onclose = () => relay.disconnect(conn);
  return conn;
}

const rtcConfig: RTCConfiguration = { iceServers: [] };

/** wait for the offer or answer to carry its addresses, since there is no server to trickle them through */
function gathered(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const timer = setTimeout(done, 4000);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export interface Invite {
  /** text for the guest */
  offer: string;
  /** feed in the guest's reply */
  accept(answer: string): Promise<void>;
  cancel(): void;
}

/** The host's end: the relay lives here. Its own game talks to it through `localTransport()`. */
export class RtcHub {
  readonly relay = new Relay();
  private timer = setInterval(() => this.relay.sweep(), 10_000);
  private pcs = new Set<RTCPeerConnection>();

  localTransport(): Transport {
    return new MemoryTransport(this.relay);
  }

  async invite(code: string): Promise<Invite> {
    const pc = new RTCPeerConnection(rtcConfig);
    this.pcs.add(pc);
    bridge(this.relay, pc.createDataChannel('link') as unknown as Channel);
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const d = pc.localDescription!;
    return {
      offer: await pack({ v: 1, code, desc: { type: 'offer', sdp: d.sdp } }),
      accept: async (answer) => {
        const p = await unpack(answer);
        if (p.desc.type !== 'answer') throw new Error('That is the host code. Paste the reply from the other device.');
        await pc.setRemoteDescription(p.desc);
      },
      cancel: () => { pc.close(); this.pcs.delete(pc); },
    };
  }

  close(): void {
    clearInterval(this.timer);
    for (const pc of this.pcs) pc.close();
    this.pcs.clear();
  }
}

/** a Transport over the data channel to the host's relay; `open()` waits until the host has accepted our reply */
class RtcClientTransport implements Transport {
  onmessage: (m: ServerMsg) => void = () => {};
  onclose: () => void = () => {};
  private ch: RTCDataChannel | null = null;
  private opened: Promise<void>;

  constructor(private pc: RTCPeerConnection, wait = 120_000) {
    this.opened = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The host never accepted the reply')), wait);
      pc.ondatachannel = (e) => {
        const ch = e.channel;
        this.ch = ch;
        ch.onmessage = (m) => { try { this.onmessage(JSON.parse(String(m.data))); } catch { /* ignore a bad frame */ } };
        ch.onclose = () => this.onclose();
        const ready = () => { clearTimeout(timer); resolve(); };
        if (ch.readyState === 'open') ready();
        else ch.onopen = ready;
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') { clearTimeout(timer); reject(new Error('Could not connect. Are both devices on the same Wi-Fi?')); this.onclose(); }
      };
    });
  }

  open(): Promise<void> { return this.opened; }

  send(msg: ClientMsg): void {
    if (this.ch?.readyState === 'open') this.ch.send(JSON.stringify(msg));
  }

  close(): void {
    this.pc.close();
  }
}

/** a transport that never connects; a retry after a paste-paired link drops lands here, since pairing cannot be redone silently */
export function deadTransport(): Transport {
  return {
    open: () => Promise.reject(new Error('The paired device is gone')),
    send: () => {},
    close: () => {},
    onmessage: () => {},
    onclose: () => {},
  };
}

export interface Reply {
  /** the room code to join with */
  code: string;
  /** text to send back to the host */
  answer: string;
  /** use this as the Link's transport; it opens once the host has accepted the answer */
  transport: Transport;
}

/** The guest's end: take the host's block, return the reply block and a transport that waits for the host to accept it. */
export async function reply(offer: string): Promise<Reply> {
  const p = await unpack(offer);
  if (p.desc.type !== 'offer' || !p.code) throw new Error('That is not a host code. Paste the one from the host device.');
  const pc = new RTCPeerConnection(rtcConfig);
  const transport = new RtcClientTransport(pc);
  await pc.setRemoteDescription(p.desc);
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  return { code: p.code, answer: await pack({ v: 1, desc: { type: 'answer', sdp: pc.localDescription!.sdp } }), transport };
}
