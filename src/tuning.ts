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
