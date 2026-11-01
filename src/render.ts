import { ENEMIES } from './enemies';
import { ARENA_R, CENTER, type Enemy, type Game } from './sim';
import { mulberry32 } from './rng';
import { STICK_R, type Stick } from './input';

export type Images = Record<string, HTMLImageElement>;

export const IMAGE_NAMES = [
  'floor-open', 'floor-rough', 'floor-mud', 'floor-gravel', 'vignette',
  'rocks-0', 'rocks-1', 'rocks-2', 'rocks-3', 'rocks-moss-0', 'rocks-moss-1', 'rocks-moss-2', 'rocks-moss-3',
  'twigs-0', 'twigs-1', 'twigs-2', 'twigs-3', 'twigs-6', 'puddles-0', 'puddles-1', 'puddles-2', 'goo-0',
  'commander-general-goo', 'commander-beefcake', 'commander-slender', 'commander-carapace', 'commander-centaur',
  'commander-sporophore', 'commander-brawler',
];

export function loadImages(names: string[] = IMAGE_NAMES): Promise<Images> {
  return Promise.all(
    names.map(
      (n) =>
        new Promise<[string, HTMLImageElement]>((res, rej) => {
          const img = new Image();
          img.onload = () => res([n, img]);
          img.onerror = () => rej(new Error(`missing art/${n}.webp`));
          img.src = `art/${n}.webp`;
        }),
    ),
  ).then((e) => Object.fromEntries(e));
}

const INK = '#0b0b0b';
const TAU = Math.PI * 2;

type Colors = { body: string; light: string; dark: string };

/** wobbling blob outline */
function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, seed: number, wob = 0.06): void {
  const n = 22;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    const rr = r * (1 + wob * Math.sin(a * 3 + t * 3 + seed) + wob * 0.6 * Math.sin(a * 5 - t * 2 + seed * 1.7));
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function ink(ctx: CanvasRenderingContext2D, w = 3): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = w;
  ctx.stroke();
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.3, y + r * 0.45, r * 1.0, r * 0.75, 0, 0, TAU);
  ctx.fill();
}

/** cel-shaded body: dark base, lit blob offset to the upper left, hard highlight, ink outline heavier lower right */
function body(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: Colors, t: number, seed: number, flash = 0): void {
  shadow(ctx, x, y, r);
  blob(ctx, x, y, r, t, seed);
  ctx.fillStyle = c.dark;
  ctx.fill();
  ctx.save();
  ctx.clip();
  blob(ctx, x - r * 0.14, y - r * 0.16, r * 0.92, t, seed);
  ctx.fillStyle = c.body;
  ctx.fill();
  blob(ctx, x - r * 0.28, y - r * 0.32, r * 0.5, t, seed + 2);
  ctx.fillStyle = c.light;
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.42, y - r * 0.45, r * 0.17, r * 0.09, -0.8, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.translate(1.6, 1.6);
  blob(ctx, x, y, r, t, seed);
  ink(ctx, 3);
  ctx.restore();
  blob(ctx, x, y, r, t, seed);
  ink(ctx, 3);
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, flash * 8)})`;
    ctx.fill();
  }
}

function eyes(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, angry: boolean): void {
  const cx = x + Math.cos(a) * r * 0.42;
  const cy = y + Math.sin(a) * r * 0.42;
  const px = -Math.sin(a);
  const py = Math.cos(a);
  for (const s of [-1, 1]) {
    const ex = cx + px * r * 0.26 * s;
    const ey = cy + py * r * 0.26 * s;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.2, 0, TAU);
    ctx.fill();
    ink(ctx, 2);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(ex + Math.cos(a) * r * 0.08, ey + Math.sin(a) * r * 0.08, r * 0.1, 0, TAU);
    ctx.fill();
    if (angry) {
      ctx.beginPath();
      ctx.moveTo(ex - Math.cos(a) * r * 0.05 - px * s * r * 0.2 + Math.cos(a) * r * 0.1 * 0, ey - Math.sin(a) * r * 0.05 - py * s * r * 0.2);
      ctx.lineTo(ex + Math.cos(a) * r * 0.3 + px * s * r * 0.2, ey + Math.sin(a) * r * 0.3 + py * s * r * 0.2);
      ink(ctx, Math.max(2, r * 0.1));
    }
  }
}

function plate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.35);
  ctx.fillStyle = '#6f7d8c';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#a9b4bd';
  ctx.fillRect(-w / 2, -h / 2, w * 0.45, h);
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.35);
  ink(ctx, 2.5);
  ctx.restore();
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  private baked!: HTMLCanvasElement;
  private decals: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;
  private cam = { x: CENTER.x, y: CENTER.y };
  private scale = 1;
  private w = 0;
  private h = 0;
  mouse = { x: 0, y: 0 };
  /** touch play: draw the virtual sticks, no crosshair, and aim from the stick instead of the mouse */
  touchMode = false;
  sticks: Stick[] = [];
  aimWorld: { x: number; y: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private imgs: Images) {
    this.ctx = canvas.getContext('2d')!;
    this.decals = document.createElement('canvas');
    this.decals.width = this.decals.height = ARENA_R;
    this.dctx = this.decals.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(this.touchMode ? 1.5 : 2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.scale = Math.max(0.7, Math.min(1.6, this.h / 620));
    this.dpr = dpr;
  }
  private dpr = 1;

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.w / 2) / this.scale + this.cam.x, y: (sy - this.h / 2) / this.scale + this.cam.y };
  }

  /** call when a new run starts */
  reset(game: Game): void {
    this.dctx.clearRect(0, 0, ARENA_R, ARENA_R);
    this.bake(game);
    this.cam.x = game.player.x;
    this.cam.y = game.player.y;
  }

  fadeDecals(): void {
    this.dctx.save();
    this.dctx.globalCompositeOperation = 'destination-out';
    this.dctx.fillStyle = 'rgba(0,0,0,0.5)';
    this.dctx.fillRect(0, 0, ARENA_R, ARENA_R);
    this.dctx.restore();
  }

  /** The dish floor, scenery and rim never change during a run, so draw them once. */
  private bake(game: Game): void {
    const size = ARENA_R * 2;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    const rng = mulberry32(77);
    g.fillStyle = '#080a07';
    g.fillRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(CENTER.x, CENTER.y, ARENA_R - 20, 0, TAU);
    g.clip();
    const pat = (name: string): CanvasPattern => {
      const p = g.createPattern(this.imgs[name], 'repeat')!;
      p.setTransform(new DOMMatrix().scale(0.7));
      return p;
    };
    g.fillStyle = pat('floor-open');
    g.fillRect(0, 0, size, size);
    // a few soft mud patches for variety
    g.globalAlpha = 0.3;
    for (let i = 0; i < 8; i++) {
      const a = rng() * TAU;
      const d = rng() * (ARENA_R - 250);
      blob(g, CENTER.x + Math.cos(a) * d, CENTER.y + Math.sin(a) * d, 140 + rng() * 160, 0, rng() * 10, 0.2);
      g.fillStyle = pat(i % 2 ? 'floor-mud' : 'floor-gravel');
      g.fill();
    }
    g.globalAlpha = 1;
    const scatter = (names: string[], count: number, scaleMin: number, scaleMax: number, rot: boolean, alpha: number) => {
      for (let i = 0; i < count; i++) {
        const a = rng() * TAU;
        const d = Math.sqrt(rng()) * (ARENA_R - 120);
        const img = this.imgs[names[Math.floor(rng() * names.length)]];
        const s = scaleMin + rng() * (scaleMax - scaleMin);
        g.save();
        g.translate(CENTER.x + Math.cos(a) * d, CENTER.y + Math.sin(a) * d);
        if (rot) g.rotate(rng() * TAU);
        g.globalAlpha = alpha;
        g.drawImage(img, (-img.width * s) / 2, (-img.height * s) / 2, img.width * s, img.height * s);
        g.restore();
      }
    };
    scatter(['puddles-0', 'puddles-1', 'puddles-2'], 14, 0.7, 1.2, true, 0.9);
    scatter(['twigs-0', 'twigs-1', 'twigs-2', 'twigs-3', 'twigs-6'], 70, 0.45, 0.8, true, 0.95);
    for (const o of game.obstacles) {
      const img = this.imgs[o.sprite];
      g.drawImage(img, o.x - (img.width * o.scale) / 2, o.y - (img.height * o.scale) / 2, img.width * o.scale, img.height * o.scale);
    }
    // darken toward the rim
    const grad = g.createRadialGradient(CENTER.x, CENTER.y, ARENA_R * 0.55, CENTER.x, CENTER.y, ARENA_R - 20);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    g.restore();
    // glass rim of the dish
    const ring = (r: number, w: number, color: string) => {
      g.beginPath();
      g.arc(CENTER.x, CENTER.y, r, 0, TAU);
      g.strokeStyle = color;
      g.lineWidth = w;
      g.stroke();
    };
    ring(ARENA_R - 22, 46, INK);
    ring(ARENA_R - 22, 38, '#3d4632');
    ring(ARENA_R - 22, 28, '#6f7a55');
    ring(ARENA_R - 36, 5, INK);
    g.beginPath();
    g.arc(CENTER.x, CENTER.y, ARENA_R - 14, Math.PI * 0.95, Math.PI * 1.6);
    g.strokeStyle = 'rgba(220,230,190,0.75)';
    g.lineWidth = 4;
    g.stroke();
    this.baked = c;
  }

  draw(game: Game): void {
    const { ctx, w, h } = this;
    const p = game.player;
    const dpr = this.dpr;
    // camera follows the hero, leaning slightly toward the cursor
    const aim = this.aimWorld ?? this.screenToWorld(this.mouse.x, this.mouse.y);
    const tx = p.x + (aim.x - p.x) * 0.12;
    const ty = p.y + (aim.y - p.y) * 0.12;
    const k = 0.15;
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
    const sh = game.shake;

    for (const s of game.splats.splice(0)) this.splat(s.x, s.y, s.r, s.color);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080a07';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2 + (Math.random() - 0.5) * sh, h / 2 + (Math.random() - 0.5) * sh);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.cam.x, -this.cam.y);
    const vx0 = this.cam.x - w / 2 / this.scale - 80;
    const vx1 = this.cam.x + w / 2 / this.scale + 80;
    const vy0 = this.cam.y - h / 2 / this.scale - 80;
    const vy1 = this.cam.y + h / 2 / this.scale + 80;
    // only the visible slice of the baked floor and the decals
    const sx = Math.max(0, Math.floor(vx0));
    const sy = Math.max(0, Math.floor(vy0));
    const sw = Math.min(ARENA_R * 2, Math.ceil(vx1)) - sx;
    const sh2 = Math.min(ARENA_R * 2, Math.ceil(vy1)) - sy;
    if (sw > 0 && sh2 > 0) {
      ctx.drawImage(this.baked, sx, sy, sw, sh2, sx, sy, sw, sh2);
      ctx.drawImage(this.decals, sx / 2, sy / 2, sw / 2, sh2 / 2, sx, sy, sw, sh2);
    }
    const vis = (x: number, y: number) => x > vx0 && x < vx1 && y > vy0 && y < vy1;

    for (const pool of game.pools) this.pool(pool, game.time);
    for (const l of game.lobs) this.lob(l, game);
    for (const k2 of game.pickups) if (vis(k2.x, k2.y)) this.pickup(k2, game.time);
    const sorted = [...game.enemies].sort((a, b) => a.y - b.y);
    for (const e of sorted) if (vis(e.x, e.y)) this.enemy(e, game);
    if (game.phase !== 'dead') this.hero(game);
    for (const b of game.bullets) if (vis(b.x, b.y)) this.bullet(b, game);
    for (const bl of game.blasts) this.blast(bl);
    for (const pt of game.particles) {
      ctx.globalAlpha = Math.min(1, pt.life / pt.max * 1.5);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
    for (const f of game.floaters) {
      const a = 1 - f.t / 0.8;
      ctx.globalAlpha = Math.max(0, a);
      ctx.font = `${f.big ? 22 : 15}px Impact, 'Arial Black', sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    if (game.phase !== 'dead' && game.stats.spell.kind === 'burst' && game.player.castCd <= 0 && game.player.mana >= game.stats.spell.cost) {
      const d = Math.hypot(aim.x - p.x, aim.y - p.y);
      const m = Math.min(1, 520 / (d || 1));
      ctx.beginPath();
      ctx.arc(p.x + (aim.x - p.x) * m, p.y + (aim.y - p.y) * m, game.stats.spell.radius, 0, TAU);
      ctx.setLineDash([8, 10]);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // vignette and crosshair in screen space
    const v = this.imgs.vignette;
    ctx.globalAlpha = 0.4;
    ctx.drawImage(v, 0, 0, w, h);
    ctx.globalAlpha = 1;
    if (game.phase === 'wave' || game.phase === 'clear') {
      if (this.touchMode) this.drawSticks();
      else this.crosshair();
    }
  }

  private drawSticks(): void {
    const { ctx } = this;
    for (const s of this.sticks) {
      const dx = s.x - s.ox;
      const dy = s.y - s.oy;
      const m = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, m / STICK_R);
      for (const [col, lw] of [[INK, 6], ['rgba(255,246,200,0.7)', 3]] as const) {
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.arc(s.ox, s.oy, STICK_R, 0, TAU);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(s.ox + (dx / m) * k * STICK_R, s.oy + (dy / m) * k * STICK_R, 24, 0, TAU);
      ctx.fillStyle = 'rgba(255,230,120,0.85)';
      ctx.fill();
      ink(ctx, 3);
    }
  }

  private crosshair(): void {
    const { ctx } = this;
    const { x, y } = this.mouse;
    for (const [col, lw] of [[INK, 5], ['#fff6c8', 2]] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, TAU);
      ctx.moveTo(x - 18, y); ctx.lineTo(x - 6, y);
      ctx.moveTo(x + 6, y); ctx.lineTo(x + 18, y);
      ctx.moveTo(x, y - 18); ctx.lineTo(x, y - 6);
      ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 18);
      ctx.stroke();
    }
  }

  private splat(x: number, y: number, r: number, color: string): void {
    const g = this.dctx;
    g.save();
    g.translate(x / 2, y / 2);
    g.scale(0.5, 0.5);
    g.globalAlpha = 0.6;
    g.fillStyle = color;
    g.beginPath();
    g.arc(0, 0, r * 0.8, 0, TAU);
    g.fill();
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * TAU;
      const d = r * (0.7 + Math.random() * 0.9);
      g.beginPath();
      g.arc(Math.cos(a) * d, Math.sin(a) * d, r * (0.12 + Math.random() * 0.2), 0, TAU);
      g.fill();
    }
    g.restore();
  }

  private hero(game: Game): void {
    const { ctx } = this;
    const p = game.player;
    const c = game.ch.colors;
    const t = game.time;
    if (p.iframes > 0 && Math.floor(t * 20) % 2 === 0) ctx.globalAlpha = 0.6;
    const armorLv = game.levels.armor ?? 0;
    const weaponLv = game.levels.weapon ?? 0;
    const r = p.r;
    shadow(ctx, p.x, p.y, r);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.aim);
    // weapon barrel sits under the body
    const bw = r * (0.42 + 0.06 * Math.min(4, weaponLv));
    ctx.beginPath();
    ctx.roundRect(r * 0.3 - p.recoil, -bw / 2, r * 1.15, bw, 3);
    ctx.fillStyle = '#6f7d8c';
    ctx.fill();
    ink(ctx, 2.5);
    ctx.fillStyle = '#a9b4bd';
    ctx.fillRect(r * 0.4 - p.recoil, -bw / 2 + 2, r * 0.9, bw * 0.25);
    ctx.restore();
    body(ctx, p.x, p.y, r, c, t * 0.8, 1, p.flash);
    // glowing core, brighter with mana
    const mana = p.mana / game.stats.maxMana;
    const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 0.5);
    gr.addColorStop(0, c.core);
    gr.addColorStop(1, 'rgba(255,240,160,0)');
    ctx.globalAlpha *= 0.4 + 0.6 * mana;
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.5, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = p.iframes > 0 && Math.floor(t * 20) % 2 === 0 ? 0.6 : 1;
    // shoulder armour grows with armour upgrades
    const ps = 1 + 0.05 * Math.min(10, armorLv);
    for (const s of [-1, 1]) {
      const a = p.aim + (s * Math.PI) / 2;
      plate(ctx, p.x + Math.cos(a) * r * 0.9 - Math.cos(p.aim) * r * 0.1, p.y + Math.sin(a) * r * 0.9 - Math.sin(p.aim) * r * 0.1, r * 0.85 * ps, r * 0.5 * ps, p.aim);
    }
    eyes(ctx, p.x, p.y, r, p.aim, true);
    ctx.globalAlpha = 1;
  }

  private enemy(e: Enemy, game: Game): void {
    const { ctx } = this;
    const def = ENEMIES[e.kind];
    const p = game.player;
    const a = Math.atan2(p.y - e.y, p.x - e.x);
    if (e.spawnT > 0) {
      const k = 1 - e.spawnT / 0.6;
      ctx.globalAlpha = 0.4 + 0.5 * k;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * (1.6 - 0.6 * k), 0, TAU);
      ctx.strokeStyle = def.colors.light;
      ctx.lineWidth = 3;
      ctx.stroke();
      body(ctx, e.x, e.y, e.r * k, def.colors, e.t, e.id);
      ctx.globalAlpha = 1;
      return;
    }
    if (e.kind === 'boss' && e.sprite) {
      const img = game.ch.portrait === e.sprite ? null : this.imgs[e.sprite];
      if (img) {
        const hgt = e.r * 3.5;
        const wid = (img.width / img.height) * hgt;
        const bob = Math.sin(e.t * 3) * 3;
        shadow(ctx, e.x, e.y + e.r * 0.4, e.r * 0.9);
        ctx.save();
        ctx.translate(e.x, e.y + bob);
        ctx.scale(e.face, 1);
        if (e.flash > 0) ctx.filter = 'brightness(2.2)';
        ctx.drawImage(img, -wid / 2, -hgt * 0.62, wid, hgt);
        ctx.restore();
        ctx.filter = 'none';
        return;
      }
    }
    body(ctx, e.x, e.y, e.r, def.colors, e.t, e.id, e.flash);
    if (e.kind === 'spitter') {
      ctx.beginPath();
      ctx.arc(e.x + Math.cos(a) * e.r * 0.85, e.y + Math.sin(a) * e.r * 0.85, e.r * 0.3, 0, TAU);
      ctx.fillStyle = def.colors.dark;
      ctx.fill();
      ink(ctx, 2.5);
    } else if (e.kind === 'brute') {
      for (const s of [-1, 1]) {
        const pa = a + (s * Math.PI) / 2;
        plate(ctx, e.x + Math.cos(pa) * e.r * 0.85, e.y + Math.sin(pa) * e.r * 0.85, e.r * 0.8, e.r * 0.5, a);
      }
    } else if (e.kind === 'splitter') {
      ctx.beginPath();
      ctx.moveTo(e.x - Math.sin(a) * e.r, e.y + Math.cos(a) * e.r);
      ctx.quadraticCurveTo(e.x + Math.cos(a) * e.r * 0.2, e.y + Math.sin(a) * e.r * 0.2, e.x + Math.sin(a) * e.r, e.y - Math.cos(a) * e.r);
      ink(ctx, 2);
    }
    eyes(ctx, e.x, e.y, e.r, a, e.kind !== 'splitter');
  }

  private bullet(b: Game['bullets'][number], game: Game): void {
    const { ctx } = this;
    if (b.friendly) {
      const c = game.ch.colors;
      ctx.beginPath();
      ctx.moveTo(b.px - b.vx * 0.02, b.py - b.vy * 0.02);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = c.body;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = b.r * 1.4;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fillStyle = c.light;
      ctx.fill();
      ink(ctx, 2);
    } else {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + Math.sin(game.time * 20) * 0.8, 0, TAU);
      ctx.fillStyle = '#b06ae0';
      ctx.fill();
      ink(ctx, 2.5);
      ctx.fillStyle = '#e6c8ff';
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.3, 0, TAU);
      ctx.fill();
    }
  }

  private pickup(k: Game['pickups'][number], t: number): void {
    const { ctx } = this;
    const bob = Math.sin(t * 6 + k.x) * 1.5;
    if (k.kind === 'gold') {
      ctx.beginPath();
      ctx.arc(k.x, k.y + bob, 7, 0, TAU);
      ctx.fillStyle = '#ffd23f';
      ctx.fill();
      ink(ctx, 2);
      ctx.fillStyle = '#fff3a0';
      ctx.beginPath();
      ctx.arc(k.x - 2, k.y + bob - 2, 2, 0, TAU);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(k.x, k.y + bob, 10, 0, TAU);
      ctx.fillStyle = '#6fdc4f';
      ctx.fill();
      ink(ctx, 2.5);
      ctx.fillStyle = '#fff';
      ctx.fillRect(k.x - 5, k.y + bob - 1.5, 10, 3);
      ctx.fillRect(k.x - 1.5, k.y + bob - 5, 3, 10);
    }
  }

  private pool(pl: Game['pools'][number], t: number): void {
    const { ctx } = this;
    const fade = Math.min(1, pl.life / 0.6);
    ctx.globalAlpha = 0.5 * fade;
    blob(ctx, pl.x, pl.y, pl.r, t, pl.x, 0.05);
    ctx.fillStyle = '#7ddc52';
    ctx.fill();
    ctx.globalAlpha = 0.9 * fade;
    ink(ctx, 3);
    ctx.fillStyle = '#d2ffa8';
    for (let i = 0; i < 5; i++) {
      const a = pl.x + i * 2.3;
      const rr = pl.r * 0.6 * ((Math.sin(t * 1.5 + a) + 1) / 2);
      ctx.beginPath();
      ctx.arc(pl.x + Math.cos(a) * rr, pl.y + Math.sin(a * 1.3) * rr, 3 + (i % 3), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private lob(l: Game['lobs'][number], game: Game): void {
    const { ctx } = this;
    const k = l.t / l.dur;
    const x = l.sx + (l.tx - l.sx) * k;
    const y = l.sy + (l.ty - l.sy) * k;
    const lift = Math.sin(Math.PI * k) * 90;
    shadow(ctx, x, y, 8);
    ctx.beginPath();
    ctx.arc(x, y - lift, 11, 0, TAU);
    ctx.fillStyle = game.ch.colors.light;
    ctx.fill();
    ink(ctx, 3);
  }

  private blast(b: Game['blasts'][number]): void {
    const { ctx } = this;
    const k = b.t / b.max;
    const e = 1 - Math.pow(1 - k, 3);
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * (0.25 + 0.75 * e), 0, TAU);
    ctx.globalAlpha = 0.25 * (1 - k);
    ctx.fillStyle = b.color;
    ctx.fill();
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 12 * (1 - k) + 2;
    ctx.stroke();
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 7 * (1 - k) + 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}


