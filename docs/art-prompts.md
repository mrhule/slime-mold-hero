# Art prompts: new art for Slime Mold: Hero

Same pipeline as the `slime-mold` repo: generate each sheet, drop the PNG in `art-source/`, and cut it out
(magenta key) with `tools/process-art.mjs`. The game currently draws the hero, slimes, bullets and spell
effects in code as ink-outlined placeholders (`src/render.ts`), so every prompt below is an upgrade, not a blocker.

## Style block (prepend to every prompt)

> Top-down view, as seen from directly above. Comic-book ink illustration style with cel shading:
> heavy near-black ink outlines (slightly thicker on the lower-right edges), flat colour bands with
> no gradients, a few hard-edged highlights, light coming from the upper left, and a small hard-edged
> drop shadow falling to the lower right. Gritty, grimy, damp forest-floor mood. Muted olive, moss green,
> soil brown and slate grey, with warm gold as the only bright accent. No text, no letters, no watermark,
> no border, no UI.

## Background rule

> Place the subject on a perfectly flat solid magenta (#FF00FF) background with nothing else in the frame
> and a clear margin around it. Do not use any magenta or pink inside the subject.

## 1. Hero molds, top-down (hero-<id>-sheet.png), one per character

Needed: General Goo (gold), Beefcake (orange), Slender (pink), later Carapace, Centaur, Sporophore.

> [style block] A sheet of 8 frames of the same small armoured slime mold hero seen from directly above, facing
> right, in a walk cycle (4 frames) and a shooting recoil (2 frames) and a hurt flash (1 frame) and a death splat
> (1 frame). Glossy [colour] goo body, glowing pale core in the middle, grey stone shoulder plates on both
> sides, a short grey spore cannon pointing right. [background rule]

## 2. Rival slime molds, top-down (enemies-sheet.png)

> [style block] A sheet of 6 different hostile slime molds seen from above, each with angry eyes: a small green
> crawler, a tiny fast yellow-green runner, a purple spitter with a mouth tube, a big rust-red brute with grey
> shoulder plates, a teal splitter with a seam down its middle, and two small split halves. [background rule]

## 3. Projectiles and effects (fx-sheet.png)

> [style block] A sheet of: a gold goo glob with a short trail, a pink needle, a purple enemy spore glob, a gold
> coin of goo, a green health glob with a white plus, an expanding shockwave ring in gold, a splat of green acid
> with bubbles, and three ink splat decals (green, purple, rust). [background rule]

## 4. Dish rim (dish-rim-ring.png)

> [style block] A full circular petri-dish glass rim seen from above, a thick ring with a dark ink outline, a pale
> highlight arc in the upper left, water drips and speckles, transparent middle. Centre of the ring on magenta.

## 5. Spell icons, 128 x 128 (spell-<name>.png)

> [style block, front-on] A round comic-style ability icon: [a lobbed goo burst / a ground-shaking nova ring /
> a violet void burst]. Thick ink outline, flat colours, single bright glow. [background rule]

## 6. Boss commanders, top-down

The current bosses reuse the front-facing commander drawings from `slime-mold`. For true top-down bosses,
ask for the commander art "seen from directly above, large, with a heavy shadow" using the existing
`commander-*.png` as the reference image.
