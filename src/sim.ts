import type { CharacterDef } from './characters';
import { BOSS_SPRITES, ENEMIES, planWave, spawnCost, type EnemyKind, type Spawn } from './enemies';
import { mulberry32 } from './rng';
import { TUNING } from './tuning';
import { UPGRADES, derive, emptyLevels, upgradeCost, type Derived, type Levels } from './upgrades';

/** The dish: a circle of radius ARENA_R centred at (ARENA_R, ARENA_R). */
export const ARENA_R = 1400;
export const CENTER = { x: ARENA_R, y: ARENA_R };

export type Phase = 'wave' | 'clear' | 'shop' | 'dead';

export interface Input {
  moveX: number;
  moveY: number;
  /** aim point in world coordinates */
  aimX: number;
  aimY: number;
  fire: boolean;
  cast: boolean;
}

export interface Obstacle { x: number; y: number; r: number; sprite: string; scale: number }
export interface Player {
  x: number; y: number; vx: number; vy: number; r: number;
  hp: number; mana: number; gold: number; aim: number;
  fireCd: number; castCd: number; iframes: number; flash: number; recoil: number;
}
export interface Enemy {
  id: number; kind: EnemyKind; x: number; y: number; vx: number; vy: number; kx: number; ky: number; r: number;
  hp: number; maxHp: number; speed: number; damage: number; gold: number;
  flash: number; t: number; atkCd: number; cd: number; cd2: number; slow: number; spawnT: number; sprite?: string; face: number;
}
export interface Bullet {
  x: number; y: number; vx: number; vy: number; r: number; damage: number; life: number; pierce: number;
  hit: number[]; friendly: boolean; px: number; py: number;
}
export interface Pickup { x: number; y: number; vx: number; vy: number; kind: 'gold' | 'heal' | 'nutrient'; value: number; t: number }
export interface Pool { x: number; y: number; r: number; life: number; max: number; dps: number; tick: number }
export interface Lob { sx: number; sy: number; tx: number; ty: number; t: number; dur: number }
export interface Blast { x: number; y: number; r: number; t: number; max: number; color: string }
export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string }
export interface Floater { x: number; y: number; text: string; t: number; color: string; big: boolean }
export interface Marker { x: number; y: number; label: string; t: number; life: number }
export interface Splat { x: number; y: number; r: number; color: string }

export type GameEvent = 'shoot' | 'hit' | 'kill' | 'hurt' | 'cast' | 'pickup' | 'waveStart' | 'waveClear' | 'dead' | 'boss' | 'buy' | 'enemyShoot';

const ROCKS = [
  { key: 'rocks-0', w: 256, h: 182 }, { key: 'rocks-1', w: 165, h: 256 }, { key: 'rocks-2', w: 201, h: 256 }, { key: 'rocks-3', w: 256, h: 182 },
  { key: 'rocks-moss-0', w: 256, h: 182 }, { key: 'rocks-moss-1', w: 165, h: 256 }, { key: 'rocks-moss-2', w: 208, h: 256 }, { key: 'rocks-moss-3', w: 256, h: 182 },
];
export const ROCK_SIZES: Record<string, { w: number; h: number }> = Object.fromEntries(ROCKS.map((r) => [r.key, { w: r.w, h: r.h }]));

/** what the commander sends to open a front: the rival's nutrient pool sizes the fight */
export interface FrontSpec {
  id: string;
  seed: number;
  /** the rival's nutrients at this front; each enemy spawned spends some */
  pool: number;
  /** how strong the rival's waves start (1 is the first wave of a solo game) */
  tier: number;
  /** 0 (our line is solid) to 1 (about to break) when the hero arrives */
  pressure: number;
}

export type FrontOutcome = 'won' | 'lost' | 'recalled';

export interface FrontState {
  spec: FrontSpec;
  /** rival nutrients not yet spent on enemies */
  pool: number;
  /** set once, when the front is decided */
  result: FrontOutcome | null;
  /** seconds left to disengage after a recall; 0 when not recalled */
  recallT: number;
  /** nutrients the hero's kills have earned the commander so far */
  bounty: number;
  /** bosses killed, each one a tech point for the commander */
  bosses: number;
}

/** a commander artillery strike: a warning ring, then a blast */
export interface Strike { x: number; y: number; r: number; t: number; delay: number; damage: number }

/** what the commander keeps from a front */
export interface FrontLoot { nutrients: number; tech: number; goo: number }

export class Game {
  readonly ch: CharacterDef;
  readonly rng: () => number;
  levels: Levels = emptyLevels();
  stats: Derived;
  player: Player;
  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  pickups: Pickup[] = [];
  pools: Pool[] = [];
  lobs: Lob[] = [];
  blasts: Blast[] = [];
  particles: Particle[] = [];
  floaters: Floater[] = [];
  obstacles: Obstacle[] = [];
  /** spots the commander has pointed out */
  markers: Marker[] = [];
  /** artillery the commander has called in */
  strikes: Strike[] = [];
  /** drained by the renderer each frame */
  splats: Splat[] = [];
  phase: Phase = 'shop';
  wave = 0;
  kills = 0;
  goldEarned = 0;
  time = 0;
  shake = 0;
  clearT = 0;
  lastClearBonus = 0;
  /**
   * Linked to a commander: no shop and no goo, because the commander buys upgrades and supplies the hero.
   * Waves run back to back.
   */
  linked = false;
  /** Linked with no front open: no waves, the hero wanders and harvests nutrient drops for the commander. */
  roaming = false;
  /** nutrients picked up while roaming, a running total the commander turns into income */
  harvested = 0;
  private dropT = 2;
  /** set when the commander deployed the hero to a front; the front, not the wave count, decides how long it lasts */
  front: FrontState | null = null;
  onEvent: (e: GameEvent) => void = () => {};
  private queue: Spawn[] = [];
  private waveTime = 0;
  private nextId = 1;
  private bossIndex = 0;

  constructor(ch: CharacterDef, seed = 1, levels?: Levels) {
    this.ch = ch;
    this.rng = mulberry32(seed);
    if (levels) this.levels = { ...emptyLevels(), ...levels };
    this.stats = derive(ch, this.levels);
    this.player = {
      x: CENTER.x, y: CENTER.y, vx: 0, vy: 0, r: ch.radius, hp: this.stats.maxHp, mana: this.stats.maxMana, gold: 0, aim: 0,
      fireCd: 0, castCd: 0, iframes: 0, flash: 0, recoil: 0,
    };
    this.placeRocks();
  }

  /** Scatter rocks across the dish, keeping the middle clear for the hero. */
  private placeRocks(): void {
    for (let tries = 0; tries < 600 && this.obstacles.length < 28; tries++) {
      const a = this.rng() * Math.PI * 2;
      const d = 300 + this.rng() * (ARENA_R - 300 - 160);
      const rock = ROCKS[Math.floor(this.rng() * ROCKS.length)];
      const scale = 0.5 + this.rng() * 0.35;
      const r = 0.2 * (rock.w + rock.h) * scale;
      const x = CENTER.x + Math.cos(a) * d;
      const y = CENTER.y + Math.sin(a) * d;
      if (this.obstacles.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + 70)) continue;
      this.obstacles.push({ x, y, r, sprite: rock.key, scale });
    }
  }

  /** a commander marker in arena coordinates, kept inside the dish */
  addMarker(x: number, y: number, label = ''): void {
    const dx = x - CENTER.x;
    const dy = y - CENTER.y;
    const d = Math.hypot(dx, dy);
    const max = ARENA_R - 80;
    if (d > max) { x = CENTER.x + (dx / d) * max; y = CENTER.y + (dy / d) * max; }
    this.markers.push({ x, y, label: label.slice(0, 16), t: 0, life: 25 });
    if (this.markers.length > 3) this.markers.shift();
  }

  /** artillery from the commander, in arena coordinates; lands after a warning `delay` */
  addStrike(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || this.strikes.length >= TUNING.strike.max || this.phase === 'dead') return;
    const dx = x - CENTER.x;
    const dy = y - CENTER.y;
    const d = Math.hypot(dx, dy);
    const max = ARENA_R - 40;
    if (d > max) { x = CENTER.x + (dx / d) * max; y = CENTER.y + (dy / d) * max; }
    const s = TUNING.strike;
    this.strikes.push({ x, y, r: s.radius, t: 0, delay: s.delay, damage: s.damage });
  }

  private updateStrikes(dt: number): void {
    for (const k of this.strikes) {
      k.t += dt;
      if (k.t >= k.delay) this.explode(k.x, k.y, k.r, k.damage, 700, false, '#ff9a3c');
    }
    this.strikes = this.strikes.filter((k) => k.t < k.delay);
  }

  /** what the commander keeps from this front so far */
  get loot(): FrontLoot {
    const f = this.front;
    if (!f) return { nutrients: 0, tech: 0, goo: 0 };
    return { nutrients: f.bounty, tech: f.bosses * TUNING.feedback.techPerBoss, goo: f.result === 'won' ? TUNING.feedback.gooOnWin : 0 };
  }

  get enemiesLeft(): number {
    return this.enemies.length + this.queue.length;
  }

  get boss(): Enemy | undefined {
    return this.enemies.find((e) => e.kind === 'boss');
  }

  startWave(): void {
    if (this.phase !== 'shop') return;
    this.wave++;
    this.phase = 'wave';
    this.waveTime = 0;
    this.queue = planWave(this.front ? this.front.spec.tier + this.wave - 1 : this.wave, this.rng);
    if (this.front) this.queue = this.spendPool(this.queue, this.front);
    this.player.hp = Math.min(this.stats.maxHp, this.player.hp);
    this.onEvent('waveStart');
  }

  /** switch to roaming: clear the field and stop the waves */
  startRoam(): void {
    this.roaming = true;
    this.linked = true;
    this.phase = 'wave';
    this.queue = [];
    this.enemies = [];
    this.bullets = this.bullets.filter((b) => b.friendly);
    this.dropT = 2;
  }

  /** the link ended: back to the ordinary waves of a solo game */
  endRoam(): void {
    if (!this.roaming) return;
    this.roaming = false;
    this.linked = false;
    this.pickups = this.pickups.filter((k) => k.kind !== 'nutrient');
    this.phase = 'shop';
    this.startWave();
  }

  private updateDrops(dt: number): void {
    const t = TUNING.roam;
    for (const k of this.pickups) if (k.kind === 'nutrient' && k.t > t.dropLife) k.value = 0;
    this.pickups = this.pickups.filter((k) => !(k.kind === 'nutrient' && k.value === 0));
    this.dropT -= dt;
    if (this.dropT > 0) return;
    this.dropT = t.dropEvery * (0.6 + this.rng() * 0.8);
    if (this.pickups.filter((k) => k.kind === 'nutrient').length >= t.maxDrops) return;
    for (let tries = 0; tries < 30; tries++) {
      const a = this.rng() * Math.PI * 2;
      const d = Math.sqrt(this.rng()) * (ARENA_R - 140);
      const x = CENTER.x + Math.cos(a) * d;
      const y = CENTER.y + Math.sin(a) * d;
      if (this.blocked(x, y, 24) || Math.hypot(x - this.player.x, y - this.player.y) < t.minDistance) continue;
      this.pickups.push({ x, y, vx: 0, vy: 0, kind: 'nutrient', value: t.dropValue, t: 0 });
      return;
    }
  }

  /** open this game as a front: the linked, endless waves become a fight over a nutrient pool */
  openFront(spec: FrontSpec): void {
    this.linked = true;
    this.front = { spec, pool: Math.max(0, spec.pool), result: null, recallT: 0, bounty: 0, bosses: 0 };
  }

  /** the rival spends its pool on the wave; whatever does not fit is never sent */
  private spendPool(plan: Spawn[], f: FrontState): Spawn[] {
    const out: Spawn[] = [];
    for (const s of plan) {
      const c = spawnCost(s.kind);
      if (c > f.pool) continue;
      f.pool -= c;
      out.push(s);
    }
    if (!out.length) f.pool = 0; // too little left to send anything: the rival is spent
    return out;
  }

  /** the commander orders a retreat; the hero has a few seconds to disengage */
  recall(): void {
    const f = this.front;
    if (!f || f.result || f.recallT > 0) return;
    f.recallT = TUNING.front.recallSeconds;
  }

  /** who is winning this front, 0 (our side) to 1 (the rival's): the commander's pressure meter */
  get pressure(): number {
    const f = this.front;
    if (!f) return 0;
    if (f.result === 'won') return 0;
    const left = f.spec.pool > 0 ? f.pool / f.spec.pool : 0;
    const hurt = 1 - Math.max(0, this.player.hp) / this.stats.maxHp;
    return Math.max(0, Math.min(1, f.spec.pressure * left + hurt * TUNING.front.hurtWeight));
  }

  private tickFront(dt: number): void {
    const f = this.front;
    if (!f || f.result) return;
    if (this.phase === 'dead') f.result = 'lost';
    else if (f.recallT > 0) {
      f.recallT -= dt;
      if (f.recallT <= 0) { f.recallT = 0; f.result = 'recalled'; }
    }
  }

  nextCost(id: string): number | null {
    const def = UPGRADES.find((u) => u.id === id);
    if (!def) return null;
    const lv = this.levels[id] ?? 0;
    return lv >= def.max ? null : upgradeCost(def, lv);
  }

  buy(id: string): boolean {
    if (this.phase !== 'shop') return false;
    const cost = this.nextCost(id);
    if (cost === null || this.player.gold < cost) return false;
    this.player.gold -= cost;
    this.levels[id] = (this.levels[id] ?? 0) + 1;
    const before = this.stats;
    this.stats = derive(this.ch, this.levels);
    if (id === 'vitality') this.player.hp += this.stats.maxHp - before.maxHp;
    if (id === 'mana') this.player.mana += this.stats.maxMana - before.maxMana;
    this.onEvent('buy');
    return true;
  }

  /** the commander bought an upgrade: set that level (never above the cap) and refresh stats */
  setLevel(id: string, level: number): boolean {
    const def = UPGRADES.find((u) => u.id === id);
    if (!def || !Number.isFinite(level)) return false;
    const next = Math.max(0, Math.min(def.max, Math.floor(level)));
    const before = this.stats;
    this.levels[id] = next;
    this.stats = derive(this.ch, this.levels);
    if (id === 'vitality') this.player.hp = Math.min(this.stats.maxHp, this.player.hp + Math.max(0, this.stats.maxHp - before.maxHp));
    if (id === 'mana') this.player.mana = Math.min(this.stats.maxMana, this.player.mana + Math.max(0, this.stats.maxMana - before.maxMana));
    this.onEvent('buy');
    return true;
  }

  /** the commander spent nutrients to restore a fraction of health and mana */
  supply(health: number, mana: number): void {
    const p = this.player;
    if (this.phase === 'dead') return;
    const h = Math.max(0, Math.min(1, health || 0));
    const m = Math.max(0, Math.min(1, mana || 0));
    if (h > 0) {
      p.hp = Math.min(this.stats.maxHp, p.hp + this.stats.maxHp * h);
      this.floaters.push({ x: p.x, y: p.y - p.r - 10, text: '+HP', t: 0, color: '#6fdc4f', big: true });
    }
    if (m > 0) {
      p.mana = Math.min(this.stats.maxMana, p.mana + this.stats.maxMana * m);
      this.floaters.push({ x: p.x, y: p.y - p.r - 28, text: '+MANA', t: 0, color: '#6ec6ff', big: true });
    }
    if (h > 0 || m > 0) this.onEvent('pickup');
  }

  update(dt: number, input: Input): void {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    this.updateFx(dt);
    this.tickFront(dt);
    if (this.phase === 'dead' || this.phase === 'shop' || this.front?.result) return;

    this.waveTime += dt;
    this.updatePlayer(dt, input);
    this.spawn(dt);
    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateLobs(dt);
    this.updatePools(dt);
    this.updateStrikes(dt);
    if (this.roaming) this.updateDrops(dt);
    this.updatePickups(dt);
    this.enemies = this.enemies.filter((e) => e.hp > 0);

    if (this.phase === 'wave' && !this.roaming && this.queue.length === 0 && this.enemies.length === 0) this.endWave();
    else if (this.phase === 'clear') {
      this.clearT -= dt;
      if (this.clearT <= 0) {
        this.phase = 'shop';
        if (this.front && this.front.pool < 1) this.front.result = 'won'; // the rival has nothing left to send
        else if (this.linked) this.startWave();
      }
    }
  }

  private endWave(): void {
    this.phase = 'clear';
    this.clearT = 1.6;
    this.bullets = this.bullets.filter((b) => b.friendly);
    this.lastClearBonus = this.linked ? 0 : 10 + 5 * this.wave;
    this.player.gold += this.lastClearBonus;
    this.goldEarned += this.lastClearBonus;
    this.player.hp = Math.min(this.stats.maxHp, this.player.hp + this.stats.maxHp * 0.25);
    this.player.mana = this.stats.maxMana;
    for (const p of this.pickups) p.t = -1; // negative age: fly to the hero
    this.onEvent('waveClear');
  }

  // ---------------------------------------------------------------- player

  private updatePlayer(dt: number, input: Input): void {
    const p = this.player;
    const s = this.stats;
    let mx = input.moveX;
    let my = input.moveY;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    const k = Math.min(1, dt * 14);
    p.vx += (mx * s.speed - p.vx) * k;
    p.vy += (my * s.speed - p.vy) * k;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    this.collide(p, p.r);
    p.aim = Math.atan2(input.aimY - p.y, input.aimX - p.x);

    p.fireCd -= dt;
    p.castCd -= dt;
    p.iframes -= dt;
    p.flash -= dt;
    p.recoil = Math.max(0, p.recoil - dt * 40);
    p.hp = Math.min(s.maxHp, p.hp + s.regen * dt);
    p.mana = Math.min(s.maxMana, p.mana + s.manaRegen * dt);

    if (input.fire && p.fireCd <= 0) this.shoot();
    if (input.cast && p.castCd <= 0 && p.mana >= s.spell.cost) this.cast(input.aimX, input.aimY);
  }

  private shoot(): void {
    const p = this.player;
    const w = this.stats.weapon;
    p.fireCd = 1 / w.rate;
    p.recoil = 4;
    // an enemy already in the muzzle zone would be behind the bullet's first step, so start the shot inside the hero
    const close = this.enemies.some((e) => {
      if (e.hp <= 0 || e.spawnT > 0) return false;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      return Math.hypot(dx, dy) < p.r + 8 + e.r + w.size && dx * Math.cos(p.aim) + dy * Math.sin(p.aim) > -e.r;
    });
    const lead = close ? 0 : p.r + 8;
    const fan = w.pellets > 1 ? Math.max(w.spread, 0.05 * (w.pellets - 1)) : 0;
    for (let i = 0; i < w.pellets; i++) {
      const off = w.pellets > 1 ? -fan + (2 * fan * i) / (w.pellets - 1) : 0;
      const a = p.aim + off + (this.rng() - 0.5) * w.spread;
      const speed = w.speed * (0.94 + this.rng() * 0.12);
      const sx = p.x + Math.cos(p.aim) * lead;
      const sy = p.y + Math.sin(p.aim) * lead;
      this.bullets.push({
        x: sx, y: sy, px: sx, py: sy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: w.size,
        damage: w.damage * this.stats.strength, life: w.range / w.speed, pierce: w.pierce, hit: [], friendly: true,
      });
    }
    this.onEvent('shoot');
  }

  private cast(tx: number, ty: number): void {
    const p = this.player;
    const sp = this.stats.spell;
    p.mana -= sp.cost;
    p.castCd = sp.cooldown;
    this.onEvent('cast');
    if (sp.kind === 'nova') {
      this.explode(p.x, p.y, sp.radius, sp.damage, 900, false);
      this.shake = Math.max(this.shake, 9);
      return;
    }
    const maxRange = 520;
    let dx = tx - p.x;
    let dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d > maxRange) { dx *= maxRange / d; dy *= maxRange / d; }
    const dist = Math.min(d, maxRange);
    this.lobs.push({ sx: p.x, sy: p.y, tx: p.x + dx, ty: p.y + dy, t: 0, dur: 0.25 + dist / 1100 });
  }

  /** Area damage with knockback; `pool` leaves a slowing acid puddle behind. */
  private explode(x: number, y: number, radius: number, damage: number, knock: number, pool: boolean, tint?: string): void {
    const color = tint ?? this.ch.colors.light;
    this.blasts.push({ x, y, r: radius, t: 0, max: 0.4, color });
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.spawnT > 0) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > radius + e.r) continue;
      const k = knock * (e.kind === 'boss' ? 0.15 : 1) * (e.r > 25 ? 0.5 : 1);
      this.damageEnemy(e, damage, (dx / d) * k, (dy / d) * k);
    }
    for (const b of this.bullets) {
      if (!b.friendly && Math.hypot(b.x - x, b.y - y) < radius) b.life = 0;
    }
    for (let i = 0; i < 22; i++) this.spark(x, y, color, 60 + this.rng() * 260);
    if (pool) this.pools.push({ x, y, r: radius * 0.85, life: 3 + 0.2 * (this.levels.magic ?? 0), max: 3 + 0.2 * (this.levels.magic ?? 0), dps: damage * 0.3, tick: 0 });
    this.shake = Math.max(this.shake, 5);
  }

  hurtPlayer(raw: number): void {
    const p = this.player;
    if (p.iframes > 0 || this.phase === 'dead') return;
    const dmg = Math.max(1, Math.round(raw * (1 - this.stats.reduction)));
    p.hp -= dmg;
    p.iframes = 0.35;
    p.flash = 0.15;
    this.shake = Math.max(this.shake, 7);
    this.floaters.push({ x: p.x, y: p.y - p.r, text: `-${dmg}`, t: 0, color: '#ff6a5a', big: true });
    for (let i = 0; i < 8; i++) this.spark(p.x, p.y, this.ch.colors.body, 40 + this.rng() * 160);
    this.onEvent('hurt');
    if (p.hp <= 0) {
      p.hp = 0;
      this.phase = 'dead';
      this.splats.push({ x: p.x, y: p.y, r: 60, color: this.ch.colors.dark });
      this.onEvent('dead');
    }
  }

  // --------------------------------------------------------------- enemies

  private spawn(dt: number): void {
    if (this.phase !== 'wave') return;
    while (this.queue.length && this.queue[0].delay <= this.waveTime) {
      if (this.enemies.length >= 110) { this.queue[0].delay = this.waveTime + 0.5; break; }
      const s = this.queue.shift()!;
      const pos = this.spawnPoint();
      this.addEnemy(s.kind, pos.x, pos.y, 1);
    }
    void dt;
  }

  private spawnPoint(): { x: number; y: number } {
    const p = this.player;
    for (let i = 0; i < 40; i++) {
      const a = this.rng() * Math.PI * 2;
      const d = 620 + this.rng() * 220;
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d;
      if (Math.hypot(x - CENTER.x, y - CENTER.y) < ARENA_R - 70 && !this.blocked(x, y, 30)) return { x, y };
    }
    // cornered near the rim: spawn on the far side of the dish
    const a = Math.atan2(p.y - CENTER.y, p.x - CENTER.x) + Math.PI + (this.rng() - 0.5);
    return { x: CENTER.x + Math.cos(a) * (ARENA_R - 200), y: CENTER.y + Math.sin(a) * (ARENA_R - 200) };
  }

  private blocked(x: number, y: number, r: number): boolean {
    return this.obstacles.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r);
  }

  addEnemy(kind: EnemyKind, x: number, y: number, hpScale: number): Enemy {
    const def = ENEMIES[kind];
    const w = this.wave;
    let hp = def.hp * (1 + 0.14 * (w - 1)) * hpScale;
    let sprite: string | undefined;
    if (kind === 'boss') {
      hp = (def.hp + 80 * w) * (1 + 0.5 * this.bossIndex);
      const sprites = BOSS_SPRITES.filter((s) => s !== this.ch.portrait);
      sprite = sprites[this.bossIndex % sprites.length];
      this.bossIndex++;
      this.onEvent('boss');
    }
    const e: Enemy = {
      id: this.nextId++, kind, x, y, vx: 0, vy: 0, kx: 0, ky: 0, r: def.radius * (hpScale < 1 ? 0.8 : 1),
      hp, maxHp: hp, speed: def.speed * Math.min(1.35, 1 + 0.012 * w) * (0.9 + this.rng() * 0.2),
      damage: def.damage * (1 + 0.05 * (w - 1)), gold: def.gold, flash: 0, t: this.rng() * 10, atkCd: 0.4,
      cd: 1 + this.rng() * 1.5, cd2: 6, slow: 0, spawnT: 0.6, sprite, face: 1,
    };
    this.enemies.push(e);
    return e;
  }

  private updateEnemies(dt: number): void {
    const p = this.player;
    const es = this.enemies;
    for (const e of es) {
      if (e.hp <= 0) continue;
      if (e.spawnT > 0) { e.spawnT -= dt; continue; }
      e.flash -= dt;
      e.t += dt;
      e.atkCd -= dt;
      e.cd -= dt;
      const slow = e.slow > 0 ? 0.55 : 1;
      e.slow -= dt;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      let ux = dx / d;
      let uy = dy / d;
      if (e.kind === 'spitter') {
        if (d < 200) { ux = -ux; uy = -uy; }
        else if (d < 280) { const t = ux; ux = -uy; uy = t; ux *= 0.8; uy *= 0.8; }
        if (e.cd <= 0 && d < 560) {
          e.cd = 2.2 + this.rng() * 0.8;
          this.enemyShot(e.x, e.y, p.x, p.y, e.damage, 250);
        }
      } else if (e.kind === 'boss') {
        if (e.cd <= 0) {
          e.cd = 3.2;
          const n = 12 + Math.min(12, this.wave);
          const off = this.rng() * 6.28;
          for (let i = 0; i < n; i++) {
            const a = off + (i / n) * Math.PI * 2;
            this.bullets.push({ x: e.x, y: e.y, px: e.x, py: e.y, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, r: 8, damage: e.damage * 0.5, life: 4, pierce: 0, hit: [], friendly: false });
          }
          this.onEvent('enemyShoot');
        }
        e.cd2 -= dt;
        if (e.cd2 <= 0) {
          e.cd2 = 8;
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            this.addEnemy('crawler', e.x + Math.cos(a) * (e.r + 20), e.y + Math.sin(a) * (e.r + 20), 0.6);
          }
        }
      }
      const k = Math.min(1, dt * 6);
      e.vx += (ux * e.speed * slow - e.vx) * k;
      e.vy += (uy * e.speed * slow - e.vy) * k;
      const decay = Math.exp(-7 * dt);
      e.kx *= decay;
      e.ky *= decay;
      e.x += (e.vx + e.kx) * dt;
      e.y += (e.vy + e.ky) * dt;
      if (Math.abs(dx) > 1) e.face = dx > 0 ? 1 : -1;
    }
    // keep the crowd from stacking on one spot
    for (let i = 0; i < es.length; i++) {
      const a = es[i];
      if (a.spawnT > 0) continue;
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j];
        if (b.spawnT > 0) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r;
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d >= min) continue;
        const push = ((min - d) / d) * 0.5;
        const wa = b.r / (a.r + b.r);
        a.x -= dx * push * wa * 2;
        a.y -= dy * push * wa * 2;
        b.x += dx * push * (1 - wa) * 2;
        b.y += dy * push * (1 - wa) * 2;
      }
    }
    for (const e of es) {
      if (e.spawnT > 0 || e.hp <= 0) continue;
      this.collide(e, e.r);
      if (e.atkCd <= 0 && Math.hypot(p.x - e.x, p.y - e.y) < e.r + p.r) {
        e.atkCd = 0.9;
        this.hurtPlayer(e.damage);
        const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
        e.kx -= ((p.x - e.x) / d) * 160;
        e.ky -= ((p.y - e.y) / d) * 160;
        p.vx += ((p.x - e.x) / d) * 120;
        p.vy += ((p.y - e.y) / d) * 120;
      }
    }
  }

  private enemyShot(x: number, y: number, tx: number, ty: number, damage: number, speed: number): void {
    const a = Math.atan2(ty - y, tx - x);
    this.bullets.push({ x, y, px: x, py: y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 7, damage, life: 3.5, pierce: 0, hit: [], friendly: false });
    this.onEvent('enemyShoot');
  }

  damageEnemy(e: Enemy, dmg: number, kx: number, ky: number, quiet = false): void {
    if (e.hp <= 0 || e.spawnT > 0) return;
    e.hp -= dmg;
    e.flash = 0.1;
    e.kx += kx;
    e.ky += ky;
    if (!quiet) {
      this.floaters.push({ x: e.x + (this.rng() - 0.5) * 10, y: e.y - e.r, text: String(Math.max(1, Math.round(dmg))), t: 0, color: '#fff3a0', big: false });
      this.onEvent('hit');
    }
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy): void {
    const def = ENEMIES[e.kind];
    this.kills++;
    if (this.front) {
      this.front.bounty += e.kind === 'boss' ? TUNING.feedback.bountyBoss : Math.round(spawnCost(e.kind) * TUNING.feedback.bountyPerCost);
      if (e.kind === 'boss') this.front.bosses++;
    }
    this.onEvent('kill');
    this.splats.push({ x: e.x, y: e.y, r: e.r * 1.4, color: def.colors.dark });
    for (let i = 0; i < 12; i++) this.spark(e.x, e.y, i % 2 ? def.colors.body : def.colors.light, 50 + this.rng() * 200);
    const value = Math.max(1, Math.round(e.gold * (1 + 0.04 * (this.wave - 1))));
    const drops = this.linked ? 0 : e.kind === 'boss' ? 10 : Math.min(3, value);
    for (let i = 0; i < drops; i++) {
      const a = this.rng() * Math.PI * 2;
      const sp = 60 + this.rng() * 120;
      const v = Math.floor(value / drops) + (i < value % drops ? 1 : 0);
      if (v > 0) this.pickups.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, kind: 'gold', value: v, t: 0 });
    }
    if (this.rng() < (e.kind === 'boss' ? 1 : 0.05)) this.pickups.push({ x: e.x, y: e.y, vx: 0, vy: 0, kind: 'heal', value: this.stats.maxHp * 0.12, t: 0 });
    if (e.kind === 'splitter') {
      for (let i = 0; i < 2; i++) {
        const c = this.addEnemy('crawler', e.x + (i ? 14 : -14), e.y, 0.5);
        c.spawnT = 0.15;
      }
    }
    if (e.kind === 'boss') this.shake = 14;
  }

  // ------------------------------------------------------------- projectiles

  private updateBullets(dt: number): void {
    const p = this.player;
    for (const b of this.bullets) {
      b.px = b.x;
      b.py = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) continue;
      if (Math.hypot(b.x - CENTER.x, b.y - CENTER.y) > ARENA_R - 30 || this.blocked(b.x, b.y, b.r * 0.5)) { b.life = 0; continue; }
      if (b.friendly) {
        for (const e of this.enemies) {
          if (e.hp <= 0 || e.spawnT > 0 || b.hit.includes(e.id)) continue;
          if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + b.r) {
            b.hit.push(e.id);
            const sp = Math.hypot(b.vx, b.vy) || 1;
            this.damageEnemy(e, b.damage, (b.vx / sp) * 60, (b.vy / sp) * 60);
            for (let i = 0; i < 3; i++) this.spark(b.x, b.y, ENEMIES[e.kind].colors.light, 40 + this.rng() * 120);
            if (b.pierce-- <= 0) { b.life = 0; break; }
          }
        }
      } else if (Math.hypot(p.x - b.x, p.y - b.y) < p.r + b.r) {
        this.hurtPlayer(b.damage);
        b.life = 0;
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  private updateLobs(dt: number): void {
    for (const l of this.lobs) l.t += dt;
    const landed = this.lobs.filter((l) => l.t >= l.dur);
    this.lobs = this.lobs.filter((l) => l.t < l.dur);
    for (const l of landed) this.explode(l.tx, l.ty, this.stats.spell.radius, this.stats.spell.damage, 380, true);
  }

  private updatePools(dt: number): void {
    for (const pool of this.pools) {
      pool.life -= dt;
      pool.tick -= dt;
      const tick = pool.tick <= 0;
      if (tick) pool.tick = 0.25;
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.spawnT > 0) continue;
        if (Math.hypot(e.x - pool.x, e.y - pool.y) < pool.r + e.r * 0.5) {
          e.slow = 0.3;
          if (tick) this.damageEnemy(e, pool.dps * 0.25, 0, 0, true);
        }
      }
    }
    this.pools = this.pools.filter((pl) => pl.life > 0);
  }

  private updatePickups(dt: number): void {
    const p = this.player;
    const rest: Pickup[] = [];
    for (const k of this.pickups) {
      k.t += dt;
      const dx = p.x - k.x;
      const dy = p.y - k.y;
      const d = Math.hypot(dx, dy) || 1;
      const pulled = k.t < 0 || k.t > 0.3 && d < this.stats.pickup;
      if (pulled) {
        const sp = k.t < 0 ? 900 : 380 + (this.stats.pickup - d) * 4;
        k.vx += ((dx / d) * sp - k.vx) * Math.min(1, dt * 10);
        k.vy += ((dy / d) * sp - k.vy) * Math.min(1, dt * 10);
      } else {
        k.vx *= Math.exp(-4 * dt);
        k.vy *= Math.exp(-4 * dt);
      }
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      if (d < p.r + 10) {
        if (k.kind === 'gold') { p.gold += k.value; this.goldEarned += k.value; }
        else if (k.kind === 'nutrient') {
          this.harvested += k.value;
          this.floaters.push({ x: k.x, y: k.y - 14, text: `+${k.value}`, t: 0, color: '#8ff0c0', big: true });
        } else p.hp = Math.min(this.stats.maxHp, p.hp + k.value);
        this.onEvent('pickup');
        continue;
      }
      rest.push(k);
    }
    this.pickups = rest;
  }

  // ------------------------------------------------------------------ misc

  /** push a circle out of rocks and the dish wall */
  private collide(o: { x: number; y: number }, r: number): void {
    for (const ob of this.obstacles) {
      const dx = o.x - ob.x;
      const dy = o.y - ob.y;
      const min = ob.r + r;
      if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
      const d = Math.hypot(dx, dy) || 0.01;
      if (d < min) { o.x = ob.x + (dx / d) * min; o.y = ob.y + (dy / d) * min; }
    }
    const dx = o.x - CENTER.x;
    const dy = o.y - CENTER.y;
    const d = Math.hypot(dx, dy);
    const max = ARENA_R - 40 - r;
    if (d > max) { o.x = CENTER.x + (dx / d) * max; o.y = CENTER.y + (dy / d) * max; }
  }

  private spark(x: number, y: number, color: string, speed: number): void {
    const a = this.rng() * Math.PI * 2;
    const life = 0.3 + this.rng() * 0.4;
    this.particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life, max: life, size: 2 + this.rng() * 4, color });
  }

  private updateFx(dt: number): void {
    for (const pt of this.particles) {
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= Math.exp(-5 * dt);
      pt.vy *= Math.exp(-5 * dt);
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
    for (const f of this.floaters) { f.t += dt; f.y -= 40 * dt; }
    this.floaters = this.floaters.filter((f) => f.t < 0.8).slice(-60);
    for (const m of this.markers) m.t += dt;
    this.markers = this.markers.filter((m) => m.t < m.life);
    for (const b of this.blasts) b.t += dt;
    this.blasts = this.blasts.filter((b) => b.t < b.max);
  }
}
