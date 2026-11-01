# Slime Mold: Hero

A top-down, browser-based walk-around-and-shoot game. You are a slime mold champion defending a petri dish
against endless, escalating waves of rival molds. Earn goo, spend it between waves on weapons, armor,
strength, health, regeneration and magic, and survive the boss that arrives every fifth wave.

The look is reused from the sibling `slime-mold` repo: cel-shaded comic ink, its floor tiles, rocks, twigs,
puddles and commander drawings. New things (hero, slimes, bullets, effects) are drawn in code in the same style
until real art exists; see `docs/art-prompts.md`.

## Controls

Designed for phones first, held sideways (portrait shows a "rotate your device" prompt). Mouse and keyboard work too, and the game switches by itself the moment you touch the screen or move a mouse.

**Touch**

| Input | Action |
|---|---|
| Left thumb, drag on the left half | Move |
| Right thumb, drag on the right half | Aim and shoot while dragging |
| ✦ button, bottom right | Cast your magic at the nearest enemy |
| ❚❚ button, top right | Pause |

**Mouse and keyboard**

| Input | Action |
|---|---|
| `W` `A` `S` `D` / arrows | Move |
| Left mouse (hold) | Shoot toward the cursor |
| Right mouse | Cast your magic (costs mana, has a cooldown) |
| `Enter` / `Space` | Start the next wave from the shop |
| `Esc` / `P` | Pause |
| `M` | Mute |

## Playable molds

Pick one on the title screen. Each has its own stats, weapon and spell, and all upgrades apply to whichever you pick.

| Mold | Style | Spell |
|---|---|---|
| General Goo | Balanced single shots | Goo Burst: lobbed at the cursor, leaves a slowing acid puddle |
| Beefcake | Tanky, short-range scatter | Quake Nova: shockwave around you |
| Slender | Fast, fragile, piercing needle stream | Void Burst |
| Carapace, Centaur, Sporophore | Locked, shown as "Coming soon" | |

To add a mold, add an entry to `CHARACTERS` in `src/characters.ts` (set `locked: false`, give it a `portrait`
from `public/art/commander-*.webp`). Nothing else needs to change.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # headless simulation tests
npm run build      # static files in dist/
npm run art        # re-key art-source/commander-*.png into public/art/*.webp
```

## How it is built

TypeScript, Vite and Canvas 2D. `src/sim.ts` is a plain simulation with no DOM (seeded, so tests replay it);
`src/render.ts`, `src/ui.ts` and `src/main.ts` draw it and run the screens. Balance lives in
`src/characters.ts`, `src/upgrades.ts` and `src/enemies.ts`.
