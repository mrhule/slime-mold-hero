/**
 * Slime Link wire protocol, shared by the relay and every game.
 * Games never share state. They send small messages and each side decides what a message means
 * (see docs/co-op-design.html).
 */
export const PROTOCOL_VERSION = 1;

/** how long a dropped peer keeps its seat before it is removed (ms) */
export const GRACE_MS = 60_000;

export type Role = 'cmd' | 'hero';

export interface PeerInfo {
  id: string;
  role: Role;
  name: string;
  /** false while the peer's connection is down but still inside the grace period */
  online: boolean;
}

/** what every game receives: the relay stamps `from`, `role` and `room` so nobody can pose as someone else */
export interface Envelope<T = unknown> {
  v: number;
  room: string;
  from: string;
  role: Role;
  seq: number;
  type: string;
  body: T;
}

export type ClientMsg =
  | { k: 'host'; role: Role; name: string }
  | { k: 'join'; code: string; role: Role; name: string; peer?: string }
  | { k: 'env'; type: string; body: unknown; seq: number }
  | { k: 'leave' }
  | { k: 'ping' };

export type ServerMsg =
  | { k: 'hosted'; code: string; me: PeerInfo }
  | { k: 'joined'; code: string; me: PeerInfo; peers: PeerInfo[] }
  | { k: 'peer'; ev: 'join' | 'drop' | 'rejoin' | 'leave'; peer: PeerInfo }
  | { k: 'env'; env: Envelope }
  | { k: 'error'; reason: 'no-room' | 'full' | 'busy' | 'bad-message' }
  | { k: 'pong' };

/** message bodies the games agree on so far; more arrive as the co-op features are built */
export interface Messages {
  /** commander asks the hero to look at a spot, in arena coordinates */
  marker: { x: number; y: number; label?: string };
  /** round trip check */
  ping: { t: number };
  pong: { t: number };
  /** commander -> hero: the commander bought this upgrade for that mold; the hero applies the new level */
  upgrade: { mold: string; id: string; level: number };
  /** commander -> hero: the commander spent nutrients to restore a fraction of the hero's health and mana (0 to 1) */
  supply: { health: number; mana: number };
  /** hero -> commander: what the commander's hero panel shows. Sent when something changes and about once a second. */
  /** commander -> hero: deploy to a front. The pool, tier and pressure come from the war at that front. */
  'front.open': { id: string; seed: number; pool: number; tier: number; pressure: number };
  /** commander -> hero: retreat; the hero has a short countdown to disengage */
  'front.recall': { id: string };
  /** hero -> commander: how the fight is going, about once a second. pressure 0 (ours) to 1 (rival's); pool is the share of the rival's nutrients left. */
  'front.progress': {
    id: string; wave: number; kills: number; hp: number; pressure: number; pool: number;
    /** nutrients the hero's kills have earned so far (a running total, so a lost message does no harm) */
    bounty: number;
    /** bosses killed so far, each one a tech point */
    bosses: number;
  };
  /** hero -> commander: the front is decided */
  'front.result': { id: string; outcome: 'won' | 'lost' | 'recalled'; kills: number; loot: { nutrients: number; tech: number; goo: number } };
  /** commander -> hero: the season and weather on the commander's map, so both players are under the same sky. Sent when it changes and about every few seconds. The commander decides it; the hero only draws it. */
  climate: { season: 'spring' | 'summer' | 'fall' | 'winter'; weather: 'clear' | 'rain' | 'storm' | 'fog' | 'frost' | 'snow' | 'blizzard'; intensity: number };
  /**
   * hero -> commander: a picture of the arena for the zoomed view, about six times a second. Every list holds plain
   * numbers to keep it small. `obstacles` (rocks) is only sent now and then, since it never changes.
   * enemies [x, y, kind, hp%], strikes [x, y, radius, progress%], defenses [kind (0 wall, 1 turret), x, y, hp%],
   * drops [x, y], markers [x, y].
   */
  'arena.view': {
    front: string | null;
    hero: { x: number; y: number; hp: number; aim: number };
    maxHp: number;
    enemies: number[][];
    strikes: number[][];
    defenses: number[][];
    drops: number[][];
    markers: number[][];
    obstacles?: number[][];
  };
  /** commander -> hero: build a wall or a turret at a spot in the arena (arena coordinates). The commander pays first. */
  defend: { kind: 'turret' | 'wall'; x: number; y: number };
  /** hero -> commander: whether the defense was built; if not, the commander gets its nutrients back */
  'defend.result': { kind: 'turret' | 'wall'; x: number; y: number; ok: boolean };
  /** commander -> hero: artillery on a spot, in arena coordinates. It lands after a warning ring. */
  strike: { x: number; y: number };
  /** commander -> hero: about once a second, drives the war-room map. The hero never answers it. */
  overview: { fronts: { id: string; name?: string; pressure: number; pool: number; hero: boolean }[]; territory: number; trend: number };
  'hero.state': { mold: string; wave: number; /** nutrients harvested from drops while roaming, a running total */ harvested: number; roaming: boolean; hp: number; maxHp: number; mana: number; maxMana: number; levels: Record<string, number> };
}

const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';

/** four letters, no I, L or O so a code read aloud is not mistaken for a number */
export function makeRoomCode(rng: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_LETTERS[Math.floor(rng() * CODE_LETTERS.length)];
  return s;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

const isRole = (r: unknown): r is Role => r === 'cmd' || r === 'hero';
const str = (s: unknown, max: number): s is string => typeof s === 'string' && s.length <= max;

/** parse and validate one text frame from a client; null means reject it */
export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > 16_384) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  switch (m.k) {
    case 'host':
      return isRole(m.role) && str(m.name, 24) ? { k: 'host', role: m.role, name: m.name } : null;
    case 'join':
      return str(m.code, 8) && isRole(m.role) && str(m.name, 24) && (m.peer === undefined || str(m.peer, 40))
        ? { k: 'join', code: normalizeCode(m.code), role: m.role, name: m.name, peer: m.peer }
        : null;
    case 'env':
      return str(m.type, 40) && typeof m.seq === 'number' ? { k: 'env', type: m.type, body: m.body, seq: m.seq } : null;
    case 'leave':
      return { k: 'leave' };
    case 'ping':
      return { k: 'ping' };
    default:
      return null;
  }
}
