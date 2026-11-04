import { Link, WebSocketTransport, type Transport } from '../link/client';
import type { Envelope, Messages } from '../link/protocol';
import { RELAY_PATH } from '../link/relay-path';
import { CHARACTERS } from './characters';
import { dlog } from './debug';
import { parseClimate } from './weather';
import { ENEMIES } from './enemies';
import type { FrontSpec, Game } from './sim';
import { TUNING } from './tuning';
import { UPGRADES, emptyLevels, type Levels } from './upgrades';

/**
 * Where the relay is. Normally next to this page (npm run lan), but `?relay=ip:port` points at another machine's, so a
 * phone that opened this game can join a room the other game is hosting.
 */
export function relayHost(): string {
  const r = new URLSearchParams(location.search).get('relay');
  return r && /^[\w.-]+(:\d+)?$/.test(r) ? r : location.host;
}

export const relayTransport = (): Transport =>
  new WebSocketTransport(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${relayHost()}${RELAY_PATH}`);

/** the address of the other game, which a QR code opens with the room to join; guessed from this page's address */
export function defaultPeer(): string {
  try {
    const saved = localStorage.getItem('slime-peer');
    if (saved) return saved;
  } catch { /* storage can be unavailable */ }
  return `${location.protocol}//${location.hostname}:5173/`;
}

export function savePeer(url: string): void {
  try { localStorage.setItem('slime-peer', url); } catch { /* storage can be unavailable */ }
}

/** what the QR code holds: the other game's page, told which room and whose relay to use. Null if the address is not a URL. */
export function joinUrl(peer: string, code: string, relay = relayHost()): string | null {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(peer) ? peer : `http://${peer}`);
    u.searchParams.set('join', code);
    u.searchParams.set('relay', relay);
    return u.toString();
  } catch {
    return null;
  }
}

/** which transport the next connection uses: the relay by default, or a paste-paired one while pairing */
export interface Route { make: () => Transport }

/** this game's side of the co-op link: it plays the hero */
export function makeLink(route: Route): Link {
  return new Link(() => route.make(), { role: 'hero', name: 'Hero' });
}

/** upgrade levels the commander has bought, kept per mold for as long as the link lasts */
export type MoldLevels = Record<string, Levels>;

export interface HeroCtx {
  game: Game | null;
  molds: MoldLevels;
  /** deploy to a front: start a fresh arena built from the spec */
  openFront: (spec: FrontSpec) => void;
  /** the latest war-room overview from the commander */
  overview?: (o: Messages['overview']) => void;
  /** the commander's season and weather */
  climate?: (c: Messages['climate']) => void;
  send: <K extends keyof Messages>(type: K, body: Messages[K]) => void;
}

/** what the commander's hero panel needs to know */
export function heroState(game: Game): Messages['hero.state'] {
  const s = game.stats;
  return {
    mold: game.ch.id,
    wave: game.wave,
    harvested: game.harvested,
    roaming: game.roaming,
    hp: Math.round(game.player.hp),
    maxHp: s.maxHp,
    mana: Math.round(game.player.mana),
    maxMana: s.maxMana,
    levels: { ...game.levels },
  };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Apply one message from the commander. Bodies are untrusted, so check them.
 * Returns true when the hero's state changed and should be reported back.
 */
export function handleEnvelope(env: Envelope, ctx: HeroCtx): boolean {
  const b = (env.body ?? {}) as Record<string, unknown>;
  if (env.type !== 'ping' && env.type !== 'overview' && env.type !== 'climate') dlog(`from ${env.role}: ${env.type}`, env.body);
  switch (env.type) {
    case 'marker': {
      const x = num(b.x);
      const y = num(b.y);
      if (ctx.game && x !== null && y !== null) ctx.game.addMarker(x, y, typeof b.label === 'string' ? b.label : '');
      return false;
    }
    case 'ping':
      ctx.send('pong', { t: num(b.t) ?? 0 });
      return false;
    case 'upgrade': {
      const level = num(b.level);
      const known = CHARACTERS.some((c) => c.id === b.mold);
      if (!known || typeof b.mold !== 'string' || typeof b.id !== 'string' || level === null || !UPGRADES.some((u) => u.id === b.id)) return false;
      const def = UPGRADES.find((u) => u.id === b.id)!;
      const clamped = Math.max(0, Math.min(def.max, Math.floor(level)));
      ctx.molds[b.mold] = { ...(ctx.molds[b.mold] ?? emptyLevels()), [b.id]: clamped };
      if (ctx.game?.ch.id === b.mold) ctx.game.setLevel(b.id, clamped);
      return true;
    }
    case 'supply':
      if (!ctx.game) return false;
      ctx.game.supply(num(b.health) ?? 0, num(b.mana) ?? 0);
      return true;
    case 'front.open': {
      const seed = num(b.seed);
      const pool = num(b.pool);
      const tier = num(b.tier);
      const pressure = num(b.pressure);
      if (typeof b.id !== 'string' || b.id.length > 40 || seed === null || pool === null || tier === null || pressure === null) return false;
      ctx.openFront({
        id: b.id,
        seed: Math.floor(seed),
        pool: Math.max(0, Math.min(2000, pool)),
        tier: Math.max(1, Math.min(60, Math.floor(tier))),
        pressure: Math.max(0, Math.min(1, pressure)),
      });
      return true;
    }
    case 'strike': {
      const x = num(b.x);
      const y = num(b.y);
      if (ctx.game && x !== null && y !== null) ctx.game.addStrike(x, y);
      return false;
    }
    case 'defend': {
      const x = num(b.x);
      const y = num(b.y);
      if (x === null || y === null || (b.kind !== 'turret' && b.kind !== 'wall')) return false;
      const ok = !!ctx.game && ctx.game.addDefense(b.kind, x, y);
      ctx.send('defend.result', { kind: b.kind, x, y, ok });
      return false;
    }
    case 'climate': {
      const c = parseClimate(b);
      if (c) ctx.climate?.(c);
      return false;
    }
    case 'overview': {
      const o = parseOverview(b);
      if (o) ctx.overview?.(o);
      return false;
    }
    case 'front.recall':
      if (ctx.game && ctx.game.front?.spec.id === b.id) ctx.game.recall();
      return false;
    default:
      return false;
  }
}

const KIND_INDEX = Object.keys(ENEMIES);

/** the arena as numbers, for the commander's zoomed view; `full` adds the rocks, which never change */
export function arenaView(game: Game, full: boolean): Messages['arena.view'] {
  const r = (n: number) => Math.round(n);
  const view: Messages['arena.view'] = {
    front: game.front?.spec.id ?? null,
    hero: { x: r(game.player.x), y: r(game.player.y), hp: Math.round((game.player.hp / game.stats.maxHp) * 100) / 100, aim: Math.round(game.player.aim * 100) / 100 },
    maxHp: game.stats.maxHp,
    enemies: game.enemies.filter((e) => e.hp > 0 && e.spawnT <= 0).slice(0, TUNING.view.maxEnemies).map((e) => [r(e.x), r(e.y), Math.max(0, KIND_INDEX.indexOf(e.kind)), Math.round((e.hp / e.maxHp) * 100)]),
    strikes: game.strikes.map((k) => [r(k.x), r(k.y), r(k.r), Math.round(Math.min(1, k.t / k.delay) * 100)]),
    defenses: game.defenses.map((d) => [d.kind === 'turret' ? 1 : 0, r(d.x), r(d.y), Math.round((d.hp / d.maxHp) * 100)]),
    drops: game.pickups.filter((k) => k.kind === 'nutrient').map((k) => [r(k.x), r(k.y)]),
    markers: game.markers.map((m) => [r(m.x), r(m.y)]),
  };
  if (full) view.obstacles = game.obstacles.map((o) => [r(o.x), r(o.y), r(o.r)]);
  return view;
}

/** the war-room data, trimmed to what the map draws; null if it is not shaped right */
export function parseOverview(b: Record<string, unknown>): Messages['overview'] | null {
  if (!Array.isArray(b.fronts)) return null;
  const unit = (v: unknown) => Math.max(0, Math.min(1, num(v) ?? 0));
  const fronts = b.fronts.slice(0, 8).flatMap((raw: unknown) => {
    const f = (raw ?? {}) as Record<string, unknown>;
    if (typeof f.id !== 'string' || f.id.length > 40) return [];
    return [{ id: f.id, name: typeof f.name === 'string' ? f.name.slice(0, 20) : undefined, pressure: unit(f.pressure), pool: unit(f.pool), hero: f.hero === true }];
  });
  return { fronts, territory: unit(b.territory), trend: Math.max(-999, Math.min(999, num(b.trend) ?? 0)) };
}

/** the one-second report for the commander's pressure meter, or null when no front is open */
export function frontProgress(game: Game): Messages['front.progress'] | null {
  const f = game.front;
  if (!f || f.result) return null;
  return {
    id: f.spec.id,
    wave: game.wave,
    kills: game.kills,
    hp: Math.round((game.player.hp / game.stats.maxHp) * 100) / 100,
    pressure: Math.round(game.pressure * 100) / 100,
    pool: f.spec.pool > 0 ? Math.round((f.pool / f.spec.pool) * 100) / 100 : 0,
    bounty: f.bounty,
    bosses: f.bosses,
  };
}
