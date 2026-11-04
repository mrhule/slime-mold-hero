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

## Co-op (work in progress)

The game works alone. A second player on the same Wi-Fi can link a commander to it; the design is in
`docs/co-op-design.html`. So far: the link layer, a lobby, markers, upgrades and supply from the commander, fronts, artillery, a war-room map, and rewards for the commander.

```bash
npm run lan        # same as dev, but reachable from other devices on your network
```

- The dev server also runs the **relay** (rooms by 4 letter code, no game logic) at `/link`. Open the printed
  Network address on each device.
- In the game choose **Co-op → Host a room** and read out the code, or open the page with `?join=CODE`.
- `/commander.html` is a stand-in commander for trying the link: join with the code, then click the dish to drop
  a marker in the hero's arena. A `ping` shows the round trip time.
- **While linked the hero has no shop and no goo.** The commander buys upgrades and supplies the hero (heal, refill mana),
  paid for from the commander's nutrients. Upgrade levels stay with each mold for as long as the link lasts and are shown
  as medals under the hero's bars. The stand-in commander has a hero panel with the upgrade list and supply buttons.
- **Fronts.** The commander deploys the hero with `front.open` (seed, the rival's nutrient pool, wave tier, starting pressure), even from the title screen. Each enemy sent spends some of the pool; when it is empty and the last enemy falls the front is won, and if the hero falls it is lost. `front.recall` gives the hero a 5 second countdown to disengage. The hero reports `front.progress` once a second (pressure, pool left, kills) and `front.result` when decided. The stand-in commander has Open front / Recall buttons, a pressure bar, and drains its own nutrients while a front is open (zero recalls the hero). 
- **Artillery.** `strike` {x, y} in arena coordinates: a red warning ring closes for 1.4 s, then a blast hurts enemies inside it (never the hero). At most 4 in flight. The commander pays and enforces the cooldown. On the stand-in, tick "call a strike" and click the dish.
- **War room.** `overview` (fronts with pressure and pool, territory, nutrient trend) arrives about once a second. The 🗺 button opens a view-only strategic board with the hero's front marked.
- **Rewards.** `front.progress` carries a running `bounty` (nutrients earned by kills) and `bosses`; `front.result` carries `loot` {nutrients, tech, goo}. Fog reveal is the commander's job while a front is open (`feedback.revealRadius`).
- **Playtesting.** Every tunable number is in `src/tuning.ts`. Press **F2** (or open with `?debug`) for a panel that edits them live, saves them in the browser, shows the front's state, and downloads a JSON log of what happened.
- **Pair by paste (no server).** Co-op → **Host by paste** makes a block of text (about 700 characters); send it to the other device any way you like (chat, email, notes). There choose **Join by paste**, paste it, and send back the reply it makes; paste that on the host and press Connect. The host's page runs the relay and the two browsers talk directly over WebRTC (`link/rtc.ts`), so it needs no hosting and works from a static site, but only on one network (no STUN or TURN). If the link drops it does not come back by itself; pair again. QR codes would make the swap easier and are not built yet.
- If a device drops off it keeps its seat for 60 seconds and rejoins on its own; after that, or if either side leaves,
  both games carry on solo.
- `link/` holds the protocol, relay and client shared by the games. `vite preview` serves the relay too.

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
