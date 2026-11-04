import { Link, WebSocketTransport } from '../link/client';
import type { Envelope, Messages } from '../link/protocol';
import { RELAY_PATH } from '../link/relay-path';
import { CHARACTERS } from './characters';
import { dlog } from './debug';
import type { FrontSpec, Game } from './sim';
import { UPGRADES, emptyLevels, type Levels } from './upgrades';

/** this game's side of the co-op link: it plays the hero */
export function makeLink(): Link {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${RELAY_PATH}`;
  return new Link(() => new WebSocketTransport(url), { role: 'hero', name: 'Hero' });
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
  send: <K extends keyof Messages>(type: K, body: Messages[K]) => void;
}

/** what the commander's hero panel needs to know */
export function heroState(game: Game): Messages['hero.state'] {
  const s = game.stats;
  return {
    mold: game.ch.id,
    wave: game.wave,
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
  if (env.type !== 'ping' && env.type !== 'overview') dlog(`from ${env.role}: ${env.type}`, env.body);
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
