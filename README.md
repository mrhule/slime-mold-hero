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
| Right thumb, hold on the right half | Fire. Left alone it aims at the nearest enemy (a ring shows the target) |
| Right thumb, push firmly while holding | Aim by hand (a dotted line shows where); ease back to the centre to return to auto-aim |
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

**Full screen on a phone.** The first tap asks the browser to hide its bars (Chrome on Android), and a ⛶ button appears if it declines; it also locks the screen to landscape. iPhone Safari does not allow this for web pages: open the page, tap Share, **Add to Home Screen**, and start it from the new icon, which opens with no browser bars. On Android the same works through the browser menu's **Install app** or **Add to Home screen**.

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
- **Roaming.** While linked and with no front open there are no waves. The hero wanders the dish and picks up random nutrient drops (`TUNING.roam`); `hero.state` carries the running total as `harvested` and the commander banks it. Opening a front starts the wave fight, and a won or recalled front sends the hero back to roaming. If the link ends, the hero goes back to ordinary waves.
- **Fronts.** The commander deploys the hero with `front.open` (seed, the rival's nutrient pool, wave tier, starting pressure), even from the title screen. Each enemy sent spends some of the pool; when it is empty and the last enemy falls the front is won, and if the hero falls it is lost. `front.recall` gives the hero a 5 second countdown to disengage. The hero reports `front.progress` once a second (pressure, pool left, kills) and `front.result` when decided. The stand-in commander has Open front / Recall buttons, a pressure bar, and drains its own nutrients while a front is open (zero recalls the hero). 
- **Artillery.** `strike` {x, y} in arena coordinates: a red warning ring closes for 1.4 s, then a blast hurts enemies inside it (never the hero). At most 4 in flight. The commander pays and enforces the cooldown. On the stand-in, tick "call a strike" and click the dish.
- **War room.** `overview` (fronts with pressure and pool, territory, nutrient trend) arrives about once a second. The 🗺 button opens a view-only strategic board with the hero's front marked.
- **Zoom view and defenses.** The hero sends `arena.view` about six times a second: its position, health, every enemy, strikes, defenses, drops and (now and then) the rocks, all as plain numbers. The commander zooms in on it to see how the fight is going, and from that view can mark, call a `strike`, or build a `wall` (blocks and soaks up hits) or a `turret` (shoots the nearest enemy) with `defend`. The commander pays first and the hero answers with `defend.result`; a refusal (blocked spot, too many) means a refund. At most 8 defenses, and enemies wear them down by touching them (`TUNING.defense`). The stand-in commander has the zoom slider and the tool picker.
- **Combat pace.** Waves are bigger, arrive in packs from several sides, and run into each other, so there is always more coming; a solo game opens the shop after every third wave. Kills build a combo that speeds your fire and give mana back, health orbs drop more often, and the screen glows red as the crowd closes in or health runs low. Every dial is in `TUNING.combat`.
- **Rewards.** `front.progress` carries a running `bounty` (nutrients earned by kills) and `bosses`; `front.result` carries `loot` {nutrients, tech, goo}. Fog reveal is the commander's job while a front is open (`feedback.revealRadius`).
- **Playtesting.** Every tunable number is in `src/tuning.ts`. Press **F2** (or open with `?debug`) for a panel that edits them live, saves them in the browser, shows the front's state, and downloads a JSON log of what happened.
- **QR code.** When you host a room, the Co-op screen shows a QR code. It holds the other game's address plus `?join=CODE&relay=host:port`, so scanning it with a phone camera opens the other game and joins your room through your relay (`relay` points a page at another machine's relay). Open the host page by the computer's network address (not `localhost`), and set "Other game's address" if the other game is not at port 5173 on the same machine. It needs `npm run lan` and plain LAN http; it will not work from https pages.
- **Pair by paste (no server).** Co-op → **Host by paste** makes a block of text (about 700 characters); send it to the other device any way you like (chat, email, notes). There choose **Join by paste**, paste it, and send back the reply it makes; paste that on the host and press Connect. The host's page runs the relay and the two browsers talk directly over WebRTC (`link/rtc.ts`), so it needs no hosting and works from a static site, but only on one network (no STUN or TURN). If the link drops it does not come back by itself; pair again. QR codes would make the swap easier and are not built yet.
- If a device drops off it keeps its seat for 60 seconds and rejoins on its own; after that, or if either side leaves,
  both games carry on solo.
- `link/` holds the protocol, relay and client shared by the games. `vite preview` serves the relay too.

## Security notes

The co-op link is built for a trusted home network, not the internet.

- `npm run lan` (`vite --host`) makes the dev server, and the relay at `/link`, reachable from every device on your network. Use it on a network you trust, and stop it when you are done. Plain `npm run dev` listens on this computer only.
- The relay has no passwords: anyone who can reach it and knows a 4 letter room code can join that room. It limits what a stranger can do: at most 64 rooms and 64 connections, frames over 16 KB are refused, a connection that guesses 8 wrong codes is cut off, and a new room never replaces an existing one.
- A web page from elsewhere on the internet cannot open the relay: WebSocket connections whose `Origin` is not this computer, a private address (10.x, 172.16-31.x, 192.168.x, `.local`) or the page's own host get a 403. `?relay=` only takes effect for those same addresses, so a crafted link cannot point the game at a stranger's server.
- Text from another device (peer names, codes, errors) is shown as text, never as markup.
- A pair-by-paste block contains the device's local network address. Send it only to the person you are pairing with.
- Messages from the commander are checked and clamped before they touch the game, but a linked commander is trusted to spend nutrients honestly: the hero applies upgrades, supplies, strikes and defenses it is sent.

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
