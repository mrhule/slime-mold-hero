import { describe, expect, it } from 'vitest';
import type { Envelope, Messages } from '../link/protocol';
import { CHARACTERS } from '../src/characters';
import { frontProgress, handleEnvelope, heroState, type HeroCtx, type MoldLevels } from '../src/coop';
import { TUNING } from '../src/tuning';
import { Game, type FrontSpec, type Input } from '../src/sim';

const idle: Input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, cast: false };

function env(type: string, body: unknown): Envelope {
  return { v: 1, room: 'ABCD', from: 'cmd-1', role: 'cmd', seq: 1, type, body };
}

function ctx(game: Game | null) {
  const sent: { type: string; body: unknown }[] = [];
  const opened: FrontSpec[] = [];
  const c: HeroCtx = { game, molds: {} as MoldLevels, openFront: (s) => opened.push(s), send: (type, body) => sent.push({ type, body }) };
  return { c, sent, opened };
}

describe('upgrades from the commander', () => {
  it('set the level on the current mold and refresh its stats', () => {
    const g = new Game(CHARACTERS[0], 1);
    const { c } = ctx(g);
    const hp = g.stats.maxHp;
    expect(handleEnvelope(env('upgrade', { mold: 'general-goo', id: 'vitality', level: 2 }), c)).toBe(true);
    expect(g.levels.vitality).toBe(2);
    expect(g.stats.maxHp).toBe(hp + 50);
    expect(g.player.hp).toBe(hp + 50); // gaining max health heals by that much
    expect(c.molds['general-goo'].vitality).toBe(2);
  });

  it('are remembered for a mold that is not in play and used when it is picked', () => {
    const { c } = ctx(null);
    handleEnvelope(env('upgrade', { mold: 'beefcake', id: 'armor', level: 3 }), c);
    expect(c.molds.beefcake.armor).toBe(3);
    const g = new Game(CHARACTERS[1], 1, c.molds.beefcake);
    expect(g.stats.armor).toBe(CHARACTERS[1].stats.armor + 12);
  });

  it('do not carry over between molds', () => {
    const g = new Game(CHARACTERS[0], 1);
    const { c } = ctx(g);
    handleEnvelope(env('upgrade', { mold: 'beefcake', id: 'strength', level: 4 }), c);
    expect(g.levels.strength).toBe(0);
  });

  it('are capped at the maximum level and rejected when malformed', () => {
    const g = new Game(CHARACTERS[0], 1);
    const { c } = ctx(g);
    handleEnvelope(env('upgrade', { mold: 'general-goo', id: 'magnet', level: 99 }), c);
    expect(g.levels.magnet).toBe(6);
    for (const bad of [{ mold: 'nobody', id: 'armor', level: 1 }, { mold: 'general-goo', id: 'cheat', level: 1 }, { mold: 'general-goo', id: 'armor', level: 'x' }, null, 'str']) {
      expect(handleEnvelope(env('upgrade', bad), c)).toBe(false);
    }
    expect(g.levels.armor).toBe(0);
  });
});

describe('supply from the commander', () => {
  it('restores a fraction of health and mana, never above the maximum', () => {
    const g = new Game(CHARACTERS[0], 1);
    const { c } = ctx(g);
    g.player.hp = 10;
    g.player.mana = 0;
    handleEnvelope(env('supply', { health: 0.4, mana: 1 }), c);
    expect(g.player.hp).toBeCloseTo(10 + g.stats.maxHp * 0.4);
    expect(g.player.mana).toBe(g.stats.maxMana);
    handleEnvelope(env('supply', { health: 5, mana: 5 }), c);
    expect(g.player.hp).toBe(g.stats.maxHp);
  });

  it('does nothing for a hero that is already down', () => {
    const g = new Game(CHARACTERS[0], 1);
    g.phase = 'dead';
    g.player.hp = 0;
    handleEnvelope(env('supply', { health: 1, mana: 1 }), ctx(g).c);
    expect(g.player.hp).toBe(0);
  });
});

describe('other messages', () => {
  it('answer a ping and report the hero state', () => {
    const g = new Game(CHARACTERS[2], 1);
    const { c, sent } = ctx(g);
    handleEnvelope(env('ping', { t: 7 }), c);
    expect(sent).toEqual([{ type: 'pong', body: { t: 7 } }]);
    const s: Messages['hero.state'] = heroState(g);
    expect(s).toMatchObject({ mold: 'slender', wave: 0, hp: 70, maxHp: 70 });
  });

  it('place a marker, ignoring one with missing coordinates', () => {
    const g = new Game(CHARACTERS[0], 1);
    const { c } = ctx(g);
    handleEnvelope(env('marker', { x: 1500, y: 1400, label: 'GO' }), c);
    handleEnvelope(env('marker', { x: 'a' }), c);
    expect(g.markers).toHaveLength(1);
  });
});

describe('fronts', () => {
  const spec: FrontSpec = { id: 'f1', seed: 5, pool: 30, tier: 2, pressure: 0.6 };

  function fight(g: Game, seconds: number): void {
    for (let t = 0; t < seconds && !g.front?.result; t += 1 / 30) {
      const near = [...g.enemies].filter((e) => e.spawnT <= 0)[0];
      const dx = near ? near.x - g.player.x : 0;
      const dy = near ? near.y - g.player.y : 0;
      const d = Math.hypot(dx, dy) || 1;
      const pace = d > 250 ? 1 : d < 150 ? -1 : 0;
      // kite: close in on the nearest enemy, back off when it is on top of the hero (shots start past the muzzle)
      g.update(1 / 30, { ...idle, moveX: (dx / d) * pace, moveY: (dy / d) * pace, aimX: near?.x ?? g.player.x + 1, aimY: near?.y ?? g.player.y, fire: !!near });
    }
  }

  it('front.open asks the game to deploy, clamping what it was given', () => {
    const { c, opened } = ctx(null);
    expect(handleEnvelope(env('front.open', { ...spec, pool: 99999, tier: 0, pressure: 7 }), c)).toBe(true);
    expect(opened).toEqual([{ id: 'f1', seed: 5, pool: 2000, tier: 1, pressure: 1 }]);
    expect(handleEnvelope(env('front.open', { id: 'f1', seed: 'x' }), c)).toBe(false);
    expect(opened).toHaveLength(1);
  });

  it('spends the pool on waves and is won once it is empty and the last enemy falls', () => {
    const g = new Game(CHARACTERS[0], spec.seed);
    g.openFront(spec);
    g.player.hp = g.stats.maxHp = 100000;
    g.startWave();
    const spawned = spec.pool - g.front!.pool;
    expect(spawned).toBeGreaterThan(0);
    expect(spawned).toBeLessThanOrEqual(spec.pool);
    fight(g, 600);
    expect(g.front!.result).toBe('won');
    expect(g.front!.pool).toBeLessThan(1);
    expect(g.kills).toBeGreaterThan(0);
    expect(g.pressure).toBe(0);
  });

  it('is lost when the hero falls', () => {
    const g = new Game(CHARACTERS[0], 1);
    g.openFront(spec);
    g.startWave();
    g.hurtPlayer(10000);
    g.update(1 / 30, idle);
    expect(g.front!.result).toBe('lost');
  });

  it('recall gives a countdown, then the front reverts', () => {
    const { c } = ctx(new Game(CHARACTERS[0], 1));
    const g = c.game!;
    g.openFront(spec);
    g.startWave();
    handleEnvelope(env('front.recall', { id: 'other' }), c);
    expect(g.front!.recallT).toBe(0);
    handleEnvelope(env('front.recall', { id: 'f1' }), c);
    expect(g.front!.recallT).toBeGreaterThan(0);
    g.update(2, idle);
    expect(g.front!.result).toBeNull();
    g.update(4, idle);
    expect(g.front!.result).toBe('recalled');
  });

  it('pressure rises as the hero is hurt and reports progress', () => {
    const g = new Game(CHARACTERS[0], 1);
    g.openFront(spec);
    const calm = g.pressure;
    g.player.hp = g.stats.maxHp / 2;
    expect(g.pressure).toBeGreaterThan(calm);
    expect(frontProgress(g)).toMatchObject({ id: 'f1', kills: 0, hp: 0.5 });
    g.front!.result = 'lost';
    expect(frontProgress(g)).toBeNull();
  });
});

describe('artillery, bounty and the war room', () => {
  const spec: FrontSpec = { id: 'f2', seed: 9, pool: 40, tier: 1, pressure: 0.5 };

  it('a strike shows a warning, then kills enemies inside the ring only', () => {
    const { c } = ctx(new Game(CHARACTERS[0], 1));
    const g = c.game!;
    g.openFront(spec);
    g.startWave();
    const near = g.addEnemy('crawler', 1700, 1400, 1);
    const far = g.addEnemy('crawler', 1000, 1400, 1);
    near.spawnT = far.spawnT = 0;
    handleEnvelope(env('strike', { x: 1700, y: 1400 }), c);
    expect(g.strikes).toHaveLength(1);
    g.update(0.5, idle);
    expect(near.hp).toBe(24);
    g.update(TUNING.strike.delay, idle);
    expect(near.hp).toBeLessThanOrEqual(0);
    expect(far.hp).toBeGreaterThan(0);
    expect(g.strikes).toHaveLength(0);
  });

  it('limits strikes in flight and keeps them inside the dish', () => {
    const g = new Game(CHARACTERS[0], 1);
    for (let i = 0; i < 10; i++) g.addStrike(99999, 1400);
    expect(g.strikes).toHaveLength(TUNING.strike.max);
    expect(Math.hypot(g.strikes[0].x - 1400, g.strikes[0].y - 1400)).toBeLessThan(1400);
    g.addStrike(NaN, 3);
    expect(g.strikes).toHaveLength(TUNING.strike.max);
  });

  it('kills earn a bounty, bosses a tech point, and a won front frees goo', () => {
    const g = new Game(CHARACTERS[0], 1);
    g.openFront(spec);
    g.startWave();
    const boss = g.addEnemy('boss', 1500, 1400, 1);
    const c1 = g.addEnemy('crawler', 1500, 1450, 1);
    boss.spawnT = c1.spawnT = 0;
    g.damageEnemy(c1, 9999, 0, 0);
    g.damageEnemy(boss, 9999, 0, 0);
    expect(g.front!.bounty).toBe(Math.round(1 * TUNING.feedback.bountyPerCost) + TUNING.feedback.bountyBoss);
    expect(g.front!.bosses).toBe(1);
    expect(g.loot).toEqual({ nutrients: g.front!.bounty, tech: TUNING.feedback.techPerBoss, goo: 0 });
    g.front!.result = 'won';
    expect(g.loot.goo).toBe(TUNING.feedback.gooOnWin);
    expect(frontProgress(new Game(CHARACTERS[0], 1))).toBeNull();
  });

  it('an enemy on top of the hero can still be shot', () => {
    const g = new Game(CHARACTERS[0], 1);
    g.startWave();
    const e = g.addEnemy('runner', g.player.x + 3, g.player.y, 1);
    e.spawnT = 0;
    for (let i = 0; i < 30 && e.hp > 0; i++) g.update(1 / 30, { ...idle, aimX: e.x, aimY: e.y, fire: true });
    expect(e.hp).toBeLessThanOrEqual(0);
  });

  it('overview is trimmed and clamped before the map sees it', () => {
    const got: Messages['overview'][] = [];
    const { c } = ctx(null);
    c.overview = (o) => got.push(o);
    handleEnvelope(env('overview', { fronts: [{ id: 'A', pressure: 4, pool: -1, hero: true }, { id: 7 }, ...Array(20).fill({ id: 'B' })], territory: 0.4, trend: 'x' }), c);
    expect(got).toHaveLength(1);
    expect(got[0].fronts).toHaveLength(8 - 1);
    expect(got[0].fronts[0]).toMatchObject({ id: 'A', pressure: 1, pool: 0, hero: true });
    expect(got[0].trend).toBe(0);
    handleEnvelope(env('overview', { fronts: 'no' }), c);
    expect(got).toHaveLength(1);
  });
});

describe('roaming', () => {
  it('has no waves, drops nutrients to harvest, and pays them out as a running total', () => {
    const g = new Game(CHARACTERS[0], 4);
    g.startRoam();
    expect(g.phase).toBe('wave');
    for (let i = 0; i < 30 * 30; i++) g.update(1 / 30, idle);
    expect(g.enemies).toHaveLength(0);
    expect(g.wave).toBe(0);
    expect(g.phase).toBe('wave');
    const drops = g.pickups.filter((k) => k.kind === 'nutrient');
    expect(drops.length).toBeGreaterThan(0);
    expect(drops.length).toBeLessThanOrEqual(TUNING.roam.maxDrops);
    for (const d of drops) expect(Math.hypot(d.x - g.player.x, d.y - g.player.y)).toBeGreaterThan(100);
    // walk onto one
    const d = drops[0];
    g.player.x = d.x;
    g.player.y = d.y;
    g.update(1 / 30, idle);
    expect(g.harvested).toBe(TUNING.roam.dropValue);
    expect(heroState(g)).toMatchObject({ roaming: true, harvested: TUNING.roam.dropValue });
  });

  it('forgets old drops, and a game that loses its link goes back to waves', () => {
    const g = new Game(CHARACTERS[0], 4);
    g.startRoam();
    g.pickups.push({ x: 1800, y: 1400, vx: 0, vy: 0, kind: 'nutrient', value: 4, t: TUNING.roam.dropLife + 1 });
    g.update(1 / 30, idle);
    expect(g.pickups.some((k) => k.x === 1800)).toBe(false);
    g.endRoam();
    expect(g.roaming).toBe(false);
    expect(g.wave).toBe(1);
    expect(g.pickups.some((k) => k.kind === 'nutrient')).toBe(false);
  });
});

describe('a linked hero', () => {
  it('has no shop and no goo: waves run back to back', () => {
    const g = new Game(CHARACTERS[0], 3);
    g.linked = true;
    g.startWave();
    for (let t = 0; t < 120 && g.wave === 1; t += 1 / 30) {
      const near = [...g.enemies].filter((e) => e.spawnT <= 0)[0];
      g.update(1 / 30, { ...idle, aimX: near?.x ?? g.player.x + 1, aimY: near?.y ?? g.player.y, fire: !!near });
    }
    for (let i = 0; i < 120 && g.wave === 1; i++) g.update(1 / 30, idle);
    expect(g.wave).toBe(2);
    expect(g.phase).toBe('wave');
    expect(g.player.gold).toBe(0);
    expect(g.kills).toBeGreaterThan(0);
  });
});
