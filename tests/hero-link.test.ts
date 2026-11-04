import { describe, expect, it } from 'vitest';
import type { Envelope, Messages } from '../link/protocol';
import { CHARACTERS } from '../src/characters';
import { handleEnvelope, heroState, type HeroCtx, type MoldLevels } from '../src/coop';
import { Game, type Input } from '../src/sim';

const idle: Input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, cast: false };

function env(type: string, body: unknown): Envelope {
  return { v: 1, room: 'ABCD', from: 'cmd-1', role: 'cmd', seq: 1, type, body };
}

function ctx(game: Game | null) {
  const sent: { type: string; body: unknown }[] = [];
  const c: HeroCtx = { game, molds: {} as MoldLevels, send: (type, body) => sent.push({ type, body }) };
  return { c, sent };
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
