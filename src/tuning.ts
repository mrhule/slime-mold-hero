/**
 * Every number that decides how the co-op game feels, in one place. The debug panel (F2 or ?debug) edits these live,
 * and the stand-in commander reads the prices from here. The real Slime Mold keeps a copy of the same values.
 */
export const TUNING = {
  front: {
    /** seconds the hero has to disengage after a recall */
    recallSeconds: 5,
    /** how much of the pressure comes from the hero's missing health */
    hurtWeight: 0.4,
    /** what the boss costs out of a front's nutrient pool */
    bossPoolCost: 20,
    /** pressure above this is the commander's cue to act */
    dangerPressure: 0.7,
    /** commander nutrients drained per second while a front is open */
    drainPerSecond: 4,
  },
  waves: {
    /** wave budget = base + perWave * tier + perWaveSq * tier^2 */
    base: 5,
    perWave: 3.2,
    perWaveSq: 0.18,
    /** a boss wave spends this share of the budget on the rest of the wave */
    bossShare: 0.6,
  },
  /** how hard and how fast the fighting is: the dials for feeling almost overwhelmed */
  combat: {
    /** scales every wave's budget, so more enemies at once */
    budgetMul: 1.5,
    /** a wave's enemies arrive over this many seconds: base + perWave * tier, at most max */
    spanBase: 5,
    spanPerWave: 0.4,
    spanMax: 13,
    /** enemies move this much faster */
    speedMul: 1.15,
    /** enemies appear this far from the hero, so the fight starts within seconds */
    spawnMin: 470,
    spawnSpan: 200,
    /** chance that a crawler or runner arrives as a pack, and the pack size range */
    packChance: 0.45,
    packMin: 3,
    packMax: 7,
    /** the next wave starts when no more than this share of the current wave is left (never over a boss) */
    overlapAt: 0.25,
    /** a solo game opens the shop after every this many waves; between them waves run into each other */
    shopEvery: 3,
    /** seconds of quiet before the shop after a cleared wave */
    clearSeconds: 0.8,
    /** kills in a row inside this many seconds build a combo */
    comboWindow: 2.5,
    /** extra fire rate per combo kill, up to the cap */
    comboRate: 0.012,
    comboCap: 0.4,
    /** mana back for every kill, so the spell can be used again and again in a crowd */
    manaPerKill: 1.5,
    /** chance a kill drops a health orb */
    healDrop: 0.08,
    /** share of max health restored when one wave runs into the next */
    chainHeal: 0.08,
  },
  /** what the commander can build in the hero's arena from the zoomed view */
  defense: {
    /** most standing at once */
    max: 8,
    /** commander prices (the real game takes the nutrients) */
    turretCost: 80,
    wallCost: 30,
    turretHp: 140,
    wallHp: 260,
    turretRadius: 24,
    wallRadius: 42,
    turretRange: 420,
    turretRate: 2.2,
    turretDamage: 9,
    turretBulletSpeed: 700,
    /** an enemy touching a defense wears it down at this share of its own damage each second */
    contactDps: 0.5,
  },
  /** how often the hero sends the commander a picture of the arena */
  view: {
    perSecond: 6,
    maxEnemies: 150,
  },
  feedback: {
    /** nutrients paid to the commander per point of pool cost killed */
    bountyPerCost: 2,
    bountyBoss: 60,
    /** tech points per boss kill */
    techPerBoss: 1,
    /** goo pool freed for the commander when a front is won */
    gooOnWin: 40,
    /** how far the hero's view reveals fog around the front, in map units */
    revealRadius: 160,
  },
  roam: {
    /** seconds between new nutrient drops while the hero has no front */
    dropEvery: 6,
    /** most drops lying around at once */
    maxDrops: 6,
    /** nutrients in one drop, paid to the commander when the hero picks it up */
    dropValue: 4,
    /** a drop nobody picks up fades after this many seconds */
    dropLife: 60,
    /** drops land at least this far from the hero */
    minDistance: 300,
  },
  strike: {
    /** commander price and cooldown (the real game enforces these) */
    cost: 60,
    cooldown: 12,
    /** seconds between the warning ring and the hit */
    delay: 1.4,
    radius: 170,
    damage: 90,
    /** most strikes in flight at once */
    max: 4,
  },
  supply: {
    healCost: 40,
    healFraction: 0.4,
    manaCost: 30,
  },
};

export type Tuning = typeof TUNING;

const STORE = 'slime-hero-tuning';
const DEFAULTS: Tuning = JSON.parse(JSON.stringify(TUNING));

/** overwrite numbers in `into` with the numbers `from` has under the same keys; anything else is ignored */
function merge(into: Record<string, unknown>, from: unknown): void {
  if (!from || typeof from !== 'object') return;
  for (const [k, v] of Object.entries(from as Record<string, unknown>)) {
    const cur = into[k];
    if (typeof cur === 'number' && typeof v === 'number' && Number.isFinite(v)) into[k] = v;
    else if (cur && typeof cur === 'object') merge(cur as Record<string, unknown>, v);
  }
}

export function loadTuning(): void {
  try {
    merge(TUNING, JSON.parse(localStorage.getItem(STORE) ?? 'null'));
  } catch { /* storage can be unavailable */ }
}

export function saveTuning(): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(TUNING));
  } catch { /* storage can be unavailable */ }
}

export function resetTuning(): void {
  merge(TUNING, DEFAULTS);
  try {
    localStorage.removeItem(STORE);
  } catch { /* storage can be unavailable */ }
}
