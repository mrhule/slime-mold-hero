export type EnemyKind = 'crawler' | 'runner' | 'spitter' | 'brute' | 'splitter' | 'boss';

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  radius: number;
  hp: number;
  speed: number;
  damage: number;
  gold: number;
  /** budget cost when a wave is composed */
  cost: number;
  minWave: number;
  weight: number;
  colors: { body: string; light: string; dark: string };
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  crawler: { kind: 'crawler', name: 'Crawler', radius: 16, hp: 24, speed: 85, damage: 8, gold: 2, cost: 1, minWave: 1, weight: 10, colors: { body: '#5ea83f', light: '#8fd264', dark: '#356b22' } },
  runner: { kind: 'runner', name: 'Runner', radius: 11, hp: 12, speed: 150, damage: 5, gold: 1, cost: 1, minWave: 2, weight: 5, colors: { body: '#b9c733', light: '#e0ec6a', dark: '#78821c' } },
  spitter: { kind: 'spitter', name: 'Spitter', radius: 15, hp: 30, speed: 70, damage: 9, gold: 4, cost: 3, minWave: 3, weight: 4, colors: { body: '#8a58c4', light: '#b98ae8', dark: '#55308a' } },
  brute: { kind: 'brute', name: 'Brute', radius: 30, hp: 160, speed: 55, damage: 22, gold: 12, cost: 8, minWave: 4, weight: 2, colors: { body: '#b8573a', light: '#e08a62', dark: '#753020' } },
  splitter: { kind: 'splitter', name: 'Splitter', radius: 20, hp: 50, speed: 75, damage: 10, gold: 5, cost: 4, minWave: 5, weight: 3, colors: { body: '#2aa6a0', light: '#62d6cf', dark: '#16645f' } },
  boss: { kind: 'boss', name: 'Rival Commander', radius: 56, hp: 700, speed: 60, damage: 30, gold: 100, cost: 0, minWave: 5, weight: 0, colors: { body: '#777', light: '#aaa', dark: '#444' } },
};

/** Commander drawings used for bosses (the molds that are not playable yet come first). */
export const BOSS_SPRITES = ['commander-carapace', 'commander-centaur', 'commander-sporophore', 'commander-brawler'];

export interface Spawn {
  kind: EnemyKind;
  /** seconds after the wave starts */
  delay: number;
}

/** what a spawn costs out of a front's nutrient pool (the boss has no wave budget cost of its own) */
export const BOSS_POOL_COST = 20;

export function spawnCost(kind: EnemyKind): number {
  return kind === 'boss' ? BOSS_POOL_COST : ENEMIES[kind].cost;
}

export function isBossWave(wave: number): boolean {
  return wave % 5 === 0;
}

/** Decides what spawns when. A budget is spent on random affordable kinds; every fifth wave adds a boss. */
export function planWave(wave: number, rng: () => number): Spawn[] {
  let budget = 5 + wave * 3.2 + wave * wave * 0.18;
  if (isBossWave(wave)) budget *= 0.6;
  const avail = Object.values(ENEMIES).filter((d) => d.kind !== 'boss' && d.minWave <= wave);
  const kinds: EnemyKind[] = [];
  while (budget >= 1 && kinds.length < 90) {
    const ok = avail.filter((d) => d.cost <= budget);
    if (!ok.length) break;
    let roll = rng() * ok.reduce((s, d) => s + d.weight, 0);
    let pick = ok[0];
    for (const d of ok) {
      roll -= d.weight;
      if (roll <= 0) { pick = d; break; }
    }
    kinds.push(pick.kind);
    budget -= pick.cost;
  }
  const duration = Math.min(22, 8 + wave * 0.7);
  const out: Spawn[] = kinds.map((kind) => ({ kind, delay: rng() * duration }));
  if (isBossWave(wave)) out.push({ kind: 'boss', delay: 1 });
  out.sort((a, b) => a.delay - b.delay);
  if (out.length) out[0].delay = Math.min(out[0].delay, 0.8);
  return out;
}
