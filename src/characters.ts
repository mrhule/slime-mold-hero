/** Playable molds. Add an entry here and it shows up on the select screen; `locked` ones are shown greyed out. */
export interface WeaponDef {
  name: string;
  damage: number;
  /** shots per second */
  rate: number;
  pellets: number;
  /** half-angle of the fan in radians */
  spread: number;
  speed: number;
  range: number;
  pierce: number;
  size: number;
}

export interface SpellDef {
  /** burst: lobbed at the cursor, leaves a slowing acid puddle. nova: a ring around the hero. */
  kind: 'burst' | 'nova';
  name: string;
  cost: number;
  cooldown: number;
  damage: number;
  radius: number;
}

export interface BaseStats {
  maxHp: number;
  regen: number;
  armor: number;
  speed: number;
  maxMana: number;
  manaRegen: number;
}

export interface CharacterDef {
  id: string;
  name: string;
  title: string;
  blurb: string;
  /** commander sprite in public/art (without extension) */
  portrait: string;
  locked: boolean;
  colors: { body: string; light: string; dark: string; core: string };
  radius: number;
  stats: BaseStats;
  weapon: WeaponDef;
  spell: SpellDef;
}

function lockedMold(id: string, name: string, title: string): CharacterDef {
  return {
    id,
    name,
    title,
    blurb: 'Coming soon.',
    portrait: `commander-${id}`,
    locked: true,
    colors: { body: '#777', light: '#aaa', dark: '#444', core: '#ddd' },
    radius: 20,
    stats: { maxHp: 100, regen: 0.5, armor: 0, speed: 215, maxMana: 100, manaRegen: 5 },
    weapon: { name: '?', damage: 10, rate: 3, pellets: 1, spread: 0.05, speed: 600, range: 500, pierce: 0, size: 6 },
    spell: { kind: 'burst', name: '?', cost: 35, cooldown: 4, damage: 50, radius: 100 },
  };
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'general-goo',
    name: 'General Goo',
    title: 'The All-Rounder',
    blurb: 'A steady spore-spitter with a lobbed goo burst that leaves a slowing puddle.',
    portrait: 'commander-general-goo',
    locked: false,
    colors: { body: '#d9a021', light: '#f3cf57', dark: '#9a6a12', core: '#fff3a0' },
    radius: 20,
    stats: { maxHp: 100, regen: 0.5, armor: 0, speed: 215, maxMana: 100, manaRegen: 5 },
    weapon: { name: 'Spore Spitter', damage: 12, rate: 4, pellets: 1, spread: 0.04, speed: 620, range: 560, pierce: 0, size: 6 },
    spell: { kind: 'burst', name: 'Goo Burst', cost: 35, cooldown: 3.5, damage: 55, radius: 105 },
  },
  {
    id: 'beefcake',
    name: 'Beefcake',
    title: 'The Bruiser',
    blurb: 'Slow and sturdy. Blasts a wide scatter of gobs up close and shakes the ground with a nova.',
    portrait: 'commander-beefcake',
    locked: false,
    colors: { body: '#c9702a', light: '#e8a24f', dark: '#85441a', core: '#ffd9a0' },
    radius: 24,
    stats: { maxHp: 160, regen: 0.8, armor: 5, speed: 185, maxMana: 80, manaRegen: 4 },
    weapon: { name: 'Gob Scatter', damage: 8, rate: 1.6, pellets: 5, spread: 0.45, speed: 540, range: 340, pierce: 0, size: 6 },
    spell: { kind: 'nova', name: 'Quake Nova', cost: 30, cooldown: 3, damage: 50, radius: 165 },
  },
  {
    id: 'slender',
    name: 'Slender',
    title: 'The Glass Cannon',
    blurb: 'Fast and fragile with a rapid piercing needle stream and a deep mana pool.',
    portrait: 'commander-slender',
    locked: false,
    colors: { body: '#d8508e', light: '#f58cb8', dark: '#8f2a5a', core: '#ffd0e4' },
    radius: 17,
    stats: { maxHp: 70, regen: 0.3, armor: 0, speed: 250, maxMana: 140, manaRegen: 8 },
    weapon: { name: 'Needle Spit', damage: 6, rate: 9, pellets: 1, spread: 0.08, speed: 760, range: 620, pierce: 1, size: 4 },
    spell: { kind: 'burst', name: 'Void Burst', cost: 30, cooldown: 3, damage: 70, radius: 95 },
  },
  lockedMold('carapace', 'Carapace', 'The Fortress'),
  lockedMold('centaur', 'Centaur', 'The Charger'),
  lockedMold('sporophore', 'Sporophore', 'The Summoner'),
];
