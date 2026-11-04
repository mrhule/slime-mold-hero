import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link } from '../link/client';
import { MemoryTransport } from '../link/memory';
import { makeRoomCode, parseClientMsg, type Envelope, type Role } from '../link/protocol';
import { Relay } from '../link/relay';

let clock = 0;
let relay: Relay;

/** a Link whose transports are in-memory; `last()` gives the current transport so a test can cut it */
function peer(role: Role, name: string) {
  let t: MemoryTransport | null = null;
  const link = new Link(() => (t = new MemoryTransport(relay)), { role, name, retryMs: 100, graceMs: 5000 });
  const states: string[] = [];
  const got: Envelope[] = [];
  link.onState((s) => states.push(s));
  link.onMessage((e) => got.push(e));
  return { link, states, got, last: () => t! };
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  relay = new Relay({ graceMs: 5000, now: () => clock, rng: () => 0.37 });
});
afterEach(() => vi.useRealTimers());

describe('rooms', () => {
  it('link a host and a joiner and carry stamped messages both ways', async () => {
    const cmd = peer('cmd', 'Ada');
    const hero = peer('hero', 'Bo');
    expect(cmd.link.state).toBe('solo');
    const code = await cmd.link.host();
    expect(cmd.link.state).toBe('hosting');
    await hero.link.join(code.toLowerCase());
    await vi.advanceTimersByTimeAsync(0);
    expect(cmd.link.state).toBe('linked');
    expect(hero.link.state).toBe('linked');

    cmd.link.send('marker', { x: 10, y: 20, label: 'here' });
    hero.link.send('ping', { t: 5 });
    await vi.advanceTimersByTimeAsync(0);
    expect(hero.got).toHaveLength(1);
    expect(hero.got[0]).toMatchObject({ type: 'marker', role: 'cmd', room: code, body: { x: 10, y: 20, label: 'here' } });
    expect(hero.got[0].from).toBe(cmd.link.me!.id);
    expect(cmd.got[0]).toMatchObject({ type: 'ping', role: 'hero' });
  });

  it('refuse a code that does not exist, and stay solo', async () => {
    const hero = peer('hero', 'Bo');
    await expect(hero.link.join('ZZZZ')).rejects.toThrow('No room');
    expect(hero.link.state).toBe('solo');
    expect(hero.link.error).toBe('No room with that code');
  });

  it('refuse a ninth peer', async () => {
    const host = peer('cmd', 'Ada');
    const code = await host.link.host();
    for (let i = 0; i < 7; i++) await peer('hero', `h${i}`).link.join(code);
    await expect(peer('hero', 'late').link.join(code)).rejects.toThrow('full');
  });

  it('send nothing while solo', () => {
    const a = peer('cmd', 'Ada');
    a.link.send('ping', { t: 1 });
    expect(a.got).toHaveLength(0);
  });
});

describe('dropping and rejoining', () => {
  it('goes dropped when the other side vanishes and linked again when it returns', async () => {
    const cmd = peer('cmd', 'Ada');
    const hero = peer('hero', 'Bo');
    const code = await cmd.link.host();
    await hero.link.join(code);
    await vi.advanceTimersByTimeAsync(0);

    hero.last().drop(); // phone lost wifi
    await vi.advanceTimersByTimeAsync(0);
    expect(cmd.link.state).toBe('dropped');
    expect(hero.link.state).toBe('dropped');

    await vi.advanceTimersByTimeAsync(200); // the hero retries and takes its old seat
    expect(hero.link.state).toBe('linked');
    expect(cmd.link.state).toBe('linked');
    expect(hero.link.me!.id).toBe(hero.link.peers.find((p) => p.role === 'hero')!.id);

    cmd.link.send('marker', { x: 1, y: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(hero.got.map((e) => e.type)).toEqual(['marker']);
  });

  it('goes back to solo when the peer leaves', async () => {
    const cmd = peer('cmd', 'Ada');
    const hero = peer('hero', 'Bo');
    const code = await cmd.link.host();
    await hero.link.join(code);
    await vi.advanceTimersByTimeAsync(0);
    // stop the hero from retrying so it really is gone
    hero.link.leave();
    await vi.advanceTimersByTimeAsync(0);
    expect(cmd.link.state).toBe('solo');
    expect(relay.rooms.size).toBe(0);
  });

  it('removes a silent peer after the grace period', async () => {
    const cmd = peer('cmd', 'Ada');
    const hero = peer('hero', 'Bo');
    const code = await cmd.link.host();
    await hero.link.join(code);
    await vi.advanceTimersByTimeAsync(0);
    hero.last().drop();
    clock = 6000;
    relay.sweep();
    await vi.advanceTimersByTimeAsync(0);
    expect(cmd.link.state).toBe('solo'); // alone after having had company
    expect(relay.rooms.size).toBe(0);
  });

  it('cancelling while hosting returns to solo and closes the room', async () => {
    const cmd = peer('cmd', 'Ada');
    await cmd.link.host();
    cmd.link.leave();
    expect(cmd.link.state).toBe('solo');
    expect(relay.rooms.size).toBe(0);
  });
});

describe('protocol', () => {
  it('makes four-letter codes without look-alike letters', () => {
    for (let i = 0; i < 200; i++) expect(makeRoomCode()).toMatch(/^[A-HJKMNP-Z]{4}$/);
  });

  it('rejects malformed or oversized frames', () => {
    expect(parseClientMsg('nope')).toBeNull();
    expect(parseClientMsg('{"k":"join","code":"AB","role":"boss","name":"x"}')).toBeNull();
    expect(parseClientMsg('{"k":"host","role":"hero","name":"' + 'x'.repeat(50) + '"}')).toBeNull();
    expect(parseClientMsg('{"k":"env","type":"marker","seq":1,"body":"' + 'x'.repeat(20000) + '"}')).toBeNull();
    expect(parseClientMsg('{"k":"join","code":" abcd ","role":"hero","name":"Bo"}')).toMatchObject({ code: 'ABCD' });
  });
});
