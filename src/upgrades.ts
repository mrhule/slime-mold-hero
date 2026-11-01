import type { CharacterDef, SpellDef, WeaponDef } from './characters';

export type Levels = Record<string, number>;

export interface UpgradeDef {
  id: string;
  name: string;
  icon: string;
  baseCost: number;
  growth: number;
  max: number;
  /** what each level gives, shown in the shop */
  blurb: string;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'weapon', name: 'Weapon', icon: '🔫', baseCost: 40, growth: 1.45, max: 10, blurb: '+9% fire rate, +6% damage. Extra shot at 4 and 8, pierce at 6 and 10' },
  { id: 'strength', name: 'Strength', icon: '💪', baseCost: 30, growth: 1.4, max: 15, blurb: '+12% damage on every shot' },
  { id: 'armor', name: 'Armor', icon: '🛡️', baseCost: 35, growth: 1.4, max: 15, blurb: '+4 armor: less damage taken' },
  { id: 'vitality', name: 'Vitality', icon: '❤️', baseCost: 25, growth: 1.35, max: 20, blurb: '+25 max health (and heals that much)' },
  { id: 'regen', name: 'Regeneration', icon: '🌱', baseCost: 30, growth: 1.45, max: 12, blurb: '+0.8 health per second' },
  { id: 'magic', name: 'Arcane Power', icon: '🔮', baseCost: 35, growth: 1.4, max: 12, blurb: '+18% spell damage, +5% spell radius' },
  { id: 'mana', name: 'Mana Pool', icon: '💧', baseCost: 25, growth: 1.35, max: 12, blurb: '+25 max mana, +1.2 mana per second' },
  { id: 'quickcast', name: 'Quick Cast', icon: '⚡', baseCost: 45, growth: 1.5, max: 8, blurb: '-7% spell cooldown and mana cost' },
  { id: 'swift', name: 'Swiftness', icon: '👟', baseCost: 30, growth: 1.5, max: 8, blurb: '+4% move speed' },
  { id: 'magnet', name: 'Goo Magnet', icon: '🧲', baseCost: 20, growth: 1.5, max: 6, blurb: '+45 pickup range' },
];

export function upgradeCost(def: UpgradeDef, level: number): number {
  return Math.round(def.baseCost * Math.pow(def.growth, level));
}

export function emptyLevels(): Levels {
  return Object.fromEntries(UPGRADES.map((u) => [u.id, 0]));
}

export interface Derived {
  maxHp: number;
  regen: number;
  armor: number;
  /** fraction of damage removed by armor, 0..1 */
  reduction: number;
  speed: number;
  maxMana: number;
  manaRegen: number;
  strength: number;
  pickup: number;
  weapon: WeaponDef;
  spell: SpellDef;
  spellPower: number;
}

export function derive(ch: CharacterDef, lv: Levels): Derived {
  const b = ch.stats;
  const w = ch.weapon;
  const wl = lv.weapon ?? 0;
  const armor = b.armor + 4 * (lv.armor ?? 0);
  const spellPower = 1 + 0.18 * (lv.magic ?? 0);
  const qc = Math.pow(0.93, lv.quickcast ?? 0);
  return {
    maxHp: b.maxHp + 25 * (lv.vitality ?? 0),
    regen: b.regen + 0.8 * (lv.regen ?? 0),
    armor,
    reduction: armor / (armor + 40),
    speed: b.speed * (1 + 0.04 * (lv.swift ?? 0)),
    maxMana: b.maxMana + 25 * (lv.mana ?? 0),
    manaRegen: b.manaRegen + 1.2 * (lv.mana ?? 0),
    strength: 1 + 0.12 * (lv.strength ?? 0),
    pickup: 70 + 45 * (lv.magnet ?? 0),
    spellPower,
    weapon: {
      ...w,
      damage: w.damage * (1 + 0.06 * wl),
      rate: w.rate * (1 + 0.09 * wl),
      pellets: w.pellets + (wl >= 4 ? 1 : 0) + (wl >= 8 ? 1 : 0),
      pierce: w.pierce + (wl >= 6 ? 1 : 0) + (wl >= 10 ? 1 : 0),
    },
    spell: {
      ...ch.spell,
      cost: ch.spell.cost * qc,
      cooldown: ch.spell.cooldown * qc,
      damage: ch.spell.damage * spellPower,
      radius: ch.spell.radius * (1 + 0.05 * (lv.magic ?? 0)),
    },
  };
}
