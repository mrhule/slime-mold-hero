import { describe, expect, it } from 'vitest';
import { hostnameOf, isPrivateHost, originAllowed, pickRelay } from '../link/hosts';
import { MemoryTransport } from '../link/memory';
import type { ServerMsg } from '../link/protocol';
import { Relay, type RelayConn } from '../link/relay';

describe('private hosts', () => {
  it('accepts this computer and private networks, and nothing on the public internet', () => {
    for (const h of ['localhost', 'localhost:5173', '127.0.0.1:5173', '[::1]:5173', '192.168.86.77:5175', '10.1.2.3', '172.16.0.9', '172.31.255.1', 'my-pc.local:5173', 'fd12:3456::1']) {
      expect(isPrivateHost(h), h).toBe(true);
    }
    for (const h of ['evil.com', 'evil.com:9000', '8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.1.1', '256.1.1.1', '', 'localhost.evil.com', '1.2.3.4.5']) {
      expect(isPrivateHost(h), h).toBe(false);
    }
    expect(hostnameOf('[::1]:80')).toBe('::1');
  });

  it('lets a page name a relay only on a private address, else uses its own', () => {
    expect(pickRelay('192.168.1.5:5173', 'x.github.io')).toBe('192.168.1.5:5173');
    expect(pickRelay('localhost:5173', 'x.github.io')).toBe('localhost:5173');
    expect(pickRelay('attacker.com:9000', '192.168.1.5:5175')).toBe('192.168.1.5:5175');
    expect(pickRelay('8.8.8.8', 'h:1')).toBe('h:1');
    expect(pickRelay(null, 'h:1')).toBe('h:1');
    expect(pickRelay('bad host/with spaces', 'h:1')).toBe('h:1');
  });

  it('refuses WebSockets opened by pages from elsewhere on the internet', () => {
    expect(originAllowed('https://evil.com', 'localhost:5173')).toBe(false);
    expect(originAllowed('http://evil.com:5173', '192.168.1.5:5173')).toBe(false);
    expect(originAllowed('null', 'localhost:5173')).toBe(false);
    expect(originAllowed('file://', 'localhost:5173')).toBe(false);
    expect(originAllowed('http://localhost:5175', 'localhost:5173')).toBe(true);
    expect(originAllowed('http://192.168.1.5:5175', '192.168.1.5:5173')).toBe(true); // the other game on the LAN
    expect(originAllowed('https://games.example.com', 'games.example.com')).toBe(true); // a page served by this very host
    expect(originAllowed(undefined, 'localhost:5173')).toBe(true); // not a browser
  });
});

describe('relay limits', () => {
  const conn = (): RelayConn & { out: ServerMsg[]; closed: boolean } => {
    const c = { out: [] as ServerMsg[], closed: false, send(m: ServerMsg) { c.out.push(m); }, close() { c.closed = true; } };
    return c;
  };

  it('stops opening rooms at the cap and never takes over an existing room', () => {
    const relay = new Relay({ maxRooms: 3 });
    for (let i = 0; i < 3; i++) relay.handle(conn(), { k: 'host', role: 'hero', name: 'h' });
    const extra = conn();
    relay.handle(extra, { k: 'host', role: 'hero', name: 'h' });
    expect(extra.out).toEqual([{ k: 'error', reason: 'busy' }]);
    expect(relay.rooms.size).toBe(3);

    // a random source that always gives the same code: the second host must be refused, not overwrite the first
    const same = new Relay({ rng: () => 0.5 });
    const a = conn();
    const b = conn();
    same.handle(a, { k: 'host', role: 'hero', name: 'a' });
    same.handle(b, { k: 'host', role: 'cmd', name: 'b' });
    expect(a.out[0].k).toBe('hosted');
    expect(b.out).toEqual([{ k: 'error', reason: 'busy' }]);
    expect(same.rooms.size).toBe(1);
  });

  it('cuts off a connection that keeps guessing room codes', () => {
    const relay = new Relay({ maxBadJoins: 4 });
    const c = conn();
    for (let i = 0; i < 4; i++) relay.handle(c, { k: 'join', code: 'ZZZ' + i, role: 'cmd', name: 'x' });
    expect(c.out.slice(0, 3).every((m) => m.k === 'error' && m.reason === 'no-room')).toBe(true);
    expect(c.out[3]).toEqual({ k: 'error', reason: 'busy' });
    expect(c.closed).toBe(true);
  });

  it('still lets a normal player join their room', async () => {
    const relay = new Relay();
    const host = new MemoryTransport(relay);
    const got: ServerMsg[] = [];
    host.onmessage = (m) => got.push(m);
    await host.open();
    host.send({ k: 'host', role: 'hero', name: 'h' });
    await new Promise((r) => setTimeout(r, 5));
    expect(got[0].k).toBe('hosted');
  });
});
