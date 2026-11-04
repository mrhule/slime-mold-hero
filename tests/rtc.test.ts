import { describe, expect, it } from 'vitest';
import { Link } from '../link/client';
import { MemoryTransport } from '../link/memory';
import type { ServerMsg } from '../link/protocol';
import { Relay } from '../link/relay';
import { bridge, pack, unpack, type Channel, type Pairing } from '../link/rtc';
import type { Transport } from '../link/client';
import type { ClientMsg } from '../link/protocol';

const sample: Pairing = { v: 1, code: 'ABCD', desc: { type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\na=candidate:1 1 udp 1 abcd.local 5000 typ host\r\n'.repeat(20) } };

describe('pairing blocks', () => {
  it('survive a round trip, even with whitespace added by pasting', async () => {
    const text = await pack(sample);
    expect(text.startsWith('SM1.')).toBe(true);
    expect(text.length).toBeLessThan(JSON.stringify(sample).length);
    expect(await unpack(`  ${text.slice(0, 20)}\n${text.slice(20)}  `)).toEqual(sample);
  });

  it('reject anything else with a readable error', async () => {
    for (const bad of ['', 'hello', 'SM1.', 'SM1.!!!', 'SM1.AAAA', 'SM2.abcd']) {
      await expect(unpack(bad)).rejects.toThrow(/not valid/);
    }
    const wrong = await pack({ v: 1, desc: { type: 'answer', sdp: 'x' } });
    expect((await unpack(wrong)).desc.type).toBe('answer');
  });
});

/** two ends of a fake data channel joined together */
function channelPair(): [Channel, Channel] {
  const make = (): Channel => ({ readyState: 'open', send: () => {}, close: () => {}, onmessage: null, onclose: null });
  const a = make();
  const b = make();
  a.send = (d) => queueMicrotask(() => b.onmessage?.({ data: d }));
  b.send = (d) => queueMicrotask(() => a.onmessage?.({ data: d }));
  a.close = () => { a.readyState = b.readyState = 'closed'; queueMicrotask(() => { a.onclose?.(); b.onclose?.(); }); };
  b.close = a.close;
  return [a, b];
}

/** a guest transport that speaks to a Channel the way RtcClientTransport does */
function guest(ch: Channel): Transport {
  const t: Transport = {
    open: () => Promise.resolve(),
    send: (m: ClientMsg) => ch.send(JSON.stringify(m)),
    close: () => ch.close(),
    onmessage: (_m: ServerMsg) => {},
    onclose: () => {},
  };
  ch.onmessage = (e) => t.onmessage(JSON.parse(String(e.data)));
  ch.onclose = () => t.onclose();
  return t;
}

describe('a host that runs the relay for a guest over a channel', () => {
  it('lets the two games link and exchange messages, and ends the link when the channel closes', async () => {
    const relay = new Relay();
    const host = new Link(() => new MemoryTransport(relay), { role: 'hero', name: 'Hero', graceMs: 0 });
    const [hostEnd, guestEnd] = channelPair();
    bridge(relay, hostEnd);
    const cmd = new Link(() => guest(guestEnd), { role: 'cmd', name: 'Cmd', graceMs: 0, retryMs: 5 });

    const code = await host.host();
    await cmd.join(code);
    expect(host.state).toBe('linked');
    expect(cmd.state).toBe('linked');

    const got: string[] = [];
    host.onMessage((e) => got.push(`${e.role}:${e.type}`));
    cmd.send('ping', { t: 1 });
    await new Promise((r) => setTimeout(r, 5));
    expect(got).toEqual(['cmd:ping']);

    guestEnd.close();
    await new Promise((r) => setTimeout(r, 30));
    expect(['dropped', 'hosting', 'solo']).toContain(host.state);
    expect(cmd.state).not.toBe('linked');
  });

  it('answers a malformed frame with an error instead of crashing', async () => {
    const relay = new Relay();
    const [hostEnd, guestEnd] = channelPair();
    bridge(relay, hostEnd);
    const seen: unknown[] = [];
    guestEnd.onmessage = (e) => seen.push(JSON.parse(String(e.data)));
    guestEnd.send('{"k":"nonsense"}');
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual([{ k: 'error', reason: 'bad-message' }]);
  });
});
