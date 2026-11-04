import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/characters';
import { isBossWave, planWave } from '../src/enemies';
import { mulberry32 } from '../src/rng';
import { Game, type Input } from '../src/sim';
import { derive, emptyLevels, upgradeCost, UPGRADES } from '../src/upgrades';

const idle: Input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, cast: false };

/** run the sim, shooting at the nearest enemy, until the phase changes or time runs out */
function autoplay(g: Game, seconds: number, cast = false): void {
  for (let t = 0; t < seconds; t += 1 / 30) {
    const near = [...g.enemies].sort((a, b) => Math.hypot(a.x - g.player.x, a.y - g.player.y) - Math.hypot(b.x - g.player.x, b.y - g.player.y))[0];
    g.update(1 / 30, { ...idle, aimX: near?.x ?? g.player.x + 1, aimY: near?.y ?? g.player.y, fire: !!near, cast: cast && !!near });
    if (g.phase === 'shop' || g.phase === 'dead') return;
  }
}

describe('waves', () => {
  it('grow bigger and add a boss every fifth wave', () => {
    const sizes = [1, 5, 10, 15].map((w) => planWave(w, mulberry32(w)).length);
    expect(sizes[1]).toBeGreaterThan(sizes[0]);
    expect(sizes[3]).toBeGreaterThan(sizes[2] - 1);
    expect(planWave(5, mulberry32(1)).some((s) => s.kind === 'boss')).toBe(true);
    expect(planWave(4, mulberry32(1)).some((s) => s.kind === 'boss')).toBe(false);
    expect(isBossWave(10)).toBe(true);
  });

  it('only use enemy kinds that have unlocked', () => {
    expect(planWave(1, mulberry32(3)).every((s) => s.kind === 'crawler')).toBe(true);
  });
});

describe('upgrades', () => {
  it('get dearer with each level and change derived stats', () => {
    for (const u of UPGRADES) expect(upgradeCost(u, 3)).toBeGreaterThan(upgradeCost(u, 0));
    const ch = CHARACTERS[0];
    const base = derive(ch, emptyLevels());
    const lv = { ...emptyLevels(), armor: 5, strength: 5, weapon: 8, vitality: 2 };
    const up = derive(ch, lv);
    expect(up.reduction).toBeGreaterThan(base.reduction);
    expect(up.strength).toBeGreaterThan(base.strength);
    expect(up.weapon.pellets).toBe(base.weapon.pellets + 2);
    expect(up.maxHp).toBe(base.maxHp + 50);
  });

  it('can only be bought in the shop with enough gold, and stop at max', () => {
    const g = new Game(CHARACTERS[0], 1);
    g.player.gold = 1000;
    g.startWave();
    expect(g.buy('strength')).toBe(false); // mid-wave
    g.phase = 'shop';
    expect(g.buy('strength')).toBe(true);
    expect(g.levels.strength).toBe(1);
    expect(g.player.gold).toBeLessThan(1000);
    g.player.gold = 0;
    expect(g.buy('strength')).toBe(false);
    g.levels.strength = 15;
    g.player.gold = 99999;
    expect(g.nextCost('strength')).toBeNull();
    expect(g.buy('strength')).toBe(false);
  });
});

describe('a run', () => {
  it('first wave can be cleared by shooting, ending in the shop with gold', () => {
    const g = new Game(CHARACTERS[0], 42);
    g.startWave();
    autoplay(g, 120);
    for (let i = 0; i < 100 && g.phase === 'clear'; i++) g.update(1 / 30, idle);
    expect(g.phase).toBe('shop');
    expect(g.kills).toBeGreaterThan(0);
    expect(g.player.gold).toBeGreaterThan(0);
  });

  it('is replayable from a seed', () => {
    const run = () => {
      const g = new Game(CHARACTERS[1], 7);
      g.startWave();
      autoplay(g, 20);
      return [g.kills, Math.round(g.player.hp), g.enemies.length];
    };
    expect(run()).toEqual(run());
  });

  it('kills the hero when left alone, and never leaves the dish', () => {
    const g = new Game(CHARACTERS[0], 5);
    g.startWave();
    for (let i = 0; i < 30 * 120 && g.phase !== 'dead'; i++) g.update(1 / 30, { ...idle, moveX: 1 });
    expect(g.phase).toBe('dead');
    expect(Math.hypot(g.player.x - 1400, g.player.y - 1400)).toBeLessThan(1400);
  });

  it('spells cost mana and go on cooldown', () => {
    const g = new Game(CHARACTERS[1], 9);
    g.startWave();
    const mana = g.player.mana;
    g.update(1 / 30, { ...idle, cast: true });
    expect(g.player.mana).toBeLessThan(mana);
    expect(g.player.castCd).toBeGreaterThan(0);
  });

  it('every playable character can be played for a few seconds', () => {
    for (const ch of CHARACTERS.filter((c) => !c.locked)) {
      const g = new Game(ch, 3);
      g.startWave();
      autoplay(g, 10, true);
      expect(Number.isFinite(g.player.hp)).toBe(true);
    }
  });

  it('fires the same way every shot, with no random scatter', () => {
    for (const ch of CHARACTERS.filter((c) => !c.locked)) {
      const g = new Game(ch, 7);
      g.startWave();
      const shots: string[] = [];
      for (let i = 0; i < 6; i++) {
        g.player.fireCd = 0;
        g.bullets = [];
        g.update(1 / 60, { moveX: 0, moveY: 0, aimX: g.player.x + 300, aimY: g.player.y + 120, fire: true, cast: false });
        shots.push(g.bullets.filter((b) => b.friendly).map((b) => `${b.vx.toFixed(3)},${b.vy.toFixed(3)}`).join('|'));
      }
      expect(shots[0]).not.toBe('');
      expect(new Set(shots).size).toBe(1);
    }
  });

  it('a better weapon fires more bullets, each hitting harder and bigger', () => {
    for (const ch of CHARACTERS.filter((c) => !c.locked)) {
      let prev = derive(ch, emptyLevels()).weapon;
      for (let wl = 1; wl <= 10; wl++) {
        const w = derive(ch, { ...emptyLevels(), weapon: wl }).weapon;
        expect(w.damage).toBeGreaterThan(prev.damage);
        expect(w.size).toBeGreaterThan(prev.size);
        expect(w.pellets).toBeGreaterThanOrEqual(prev.pellets);
        prev = w;
      }
      expect(prev.pellets).toBe(ch.weapon.pellets + 3);
    }
    const base = new Game(CHARACTERS[0], 3);
    const maxed = new Game(CHARACTERS[0], 3, { ...emptyLevels(), weapon: 10 });
    for (const g of [base, maxed]) {
      g.startWave();
      g.player.fireCd = 0;
      g.update(1 / 60, { moveX: 0, moveY: 0, aimX: g.player.x + 300, aimY: g.player.y, fire: true, cast: false });
    }
    const shots = (g: Game) => g.bullets.filter((b) => b.friendly);
    expect(shots(maxed).length).toBe(shots(base).length + 3);
    expect(shots(maxed)[0].damage).toBeGreaterThan(shots(base)[0].damage);
    expect(shots(maxed)[0].r).toBeGreaterThan(shots(base)[0].r);
  });
});
