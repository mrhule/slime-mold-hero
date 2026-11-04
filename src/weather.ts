import type { Messages } from '../link/protocol';

export type Climate = Messages['climate'];
type Kind = Climate['weather'];
type SeasonName = Climate['season'];

/** the colour the whole screen is washed with for each season, matching the commander's map */
const SEASON_WASH: Record<SeasonName, { r: number; g: number; b: number; a: number }> = {
  spring: { r: 182, g: 240, b: 154, a: 0.06 },
  summer: { r: 255, g: 233, b: 168, a: 0.05 },
  fall: { r: 107, g: 58, b: 20, a: 0.16 },
  winter: { r: 31, g: 47, b: 85, a: 0.22 },
};

const KINDS: readonly Kind[] = ['clear', 'rain', 'storm', 'fog', 'frost', 'snow', 'blizzard'];

/** a repeatable pseudo-random number in [0, 1) for item `i` and purpose `k`, so particles do not jump between frames */
const rnd = (i: number, k: number): number => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const wrap = (v: number, m: number): number => ((v % m) + m) % m;

/**
 * The commander's weather, drawn over the hero's screen so both players are under the same sky.
 * The commander is the one that decides the weather; this only follows it. Each kind fades in and out, so a change
 * is never a jump. Particle counts are capped so a phone keeps its frame rate.
 */
export class WeatherFx {
  private target: Climate | null = null;
  private level: Record<Kind, number> = { clear: 0, rain: 0, storm: 0, fog: 0, frost: 0, snow: 0, blizzard: 0 };
  private wash = { r: 0, g: 0, b: 0, a: 0 };
  private intensity = 0;
  private flash = 0;
  private nextBolt = 4;
  private last: number | null = null;

  /** null when there is no commander: the sky clears */
  set(c: Climate | null): void {
    this.target = c;
  }

  get active(): boolean {
    return !!this.target || this.wash.a > 0.003 || KINDS.some((k) => this.level[k] > 0.01);
  }

  private update(dt: number): void {
    const t = this.target;
    const ease = Math.min(1, dt * 0.6);
    for (const k of KINDS) {
      const goal = t && k === t.weather && k !== 'clear' ? 1 : 0;
      this.level[k] += (goal - this.level[k]) * ease;
    }
    const w = t ? SEASON_WASH[t.season] : { r: this.wash.r, g: this.wash.g, b: this.wash.b, a: 0 };
    for (const c of ['r', 'g', 'b', 'a'] as const) this.wash[c] += (w[c] - this.wash[c]) * ease;
    this.intensity += ((t ? Math.max(0.2, Math.min(1, t.intensity)) : 0) - this.intensity) * ease;
    this.flash = Math.max(0, this.flash - dt * 2.5);
    if (this.level.storm > 0.5) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.flash = 1; this.nextBolt = 4 + Math.random() * 7; }
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
    const dt = this.last === null ? 0 : Math.min(0.1, Math.max(0, time - this.last));
    this.last = time;
    this.update(dt);
    if (!this.active) return;
    const area = (w * h) / (800 * 450);
    const I = this.intensity;
    ctx.save();

    if (this.wash.a > 0.003) {
      ctx.fillStyle = `rgba(${Math.round(this.wash.r)},${Math.round(this.wash.g)},${Math.round(this.wash.b)},${this.wash.a})`;
      ctx.fillRect(0, 0, w, h);
    }

    const wet = Math.max(this.level.rain, this.level.storm);
    if (wet > 0.01) {
      if (this.level.storm > 0.01) {
        ctx.fillStyle = `rgba(8,14,30,${0.28 * this.level.storm})`;
        ctx.fillRect(0, 0, w, h);
      }
      const n = Math.min(160, Math.round((70 + 90 * I) * area * wet));
      const speed = 640 + 360 * this.level.storm;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(190,215,255,${0.38 * wet})`;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const sp = speed * (0.75 + rnd(i, 3) * 0.5);
        const x = wrap(rnd(i, 1) * w - time * 90 * (1 + this.level.storm), w + 40);
        const y = wrap(rnd(i, 2) * h + time * sp, h + 40) - 20;
        const len = 12 + rnd(i, 4) * 14;
        ctx.moveTo(x, y);
        ctx.lineTo(x - len * 0.16, y + len);
      }
      ctx.stroke();
    }

    const cold = Math.max(this.level.snow, this.level.blizzard);
    if (cold > 0.01) {
      if (this.level.blizzard > 0.01) {
        ctx.fillStyle = `rgba(225,235,250,${0.3 * this.level.blizzard})`;
        ctx.fillRect(0, 0, w, h);
      }
      const n = Math.min(130, Math.round((50 + 70 * I) * area * cold + 40 * this.level.blizzard));
      ctx.fillStyle = `rgba(255,255,255,${0.85 * cold})`;
      for (let i = 0; i < n; i++) {
        const sp = (50 + rnd(i, 3) * 60) * (1 + 3 * this.level.blizzard);
        const sway = Math.sin(time * 1.3 + rnd(i, 5) * 6.28) * 18;
        const x = wrap(rnd(i, 1) * w + sway - time * 160 * this.level.blizzard, w + 20) - 10;
        const y = wrap(rnd(i, 2) * h + time * sp, h + 20) - 10;
        const r = 1.2 + rnd(i, 4) * 2.2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (this.level.fog > 0.01) {
      ctx.fillStyle = `rgba(205,215,200,${0.2 * this.level.fog * (0.6 + 0.4 * I)})`;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 5; i++) {
        const cx = wrap(rnd(i, 1) * w + time * (8 + i * 3), w * 1.4) - w * 0.2;
        const cy = rnd(i, 2) * h;
        const r = Math.max(w, h) * (0.3 + rnd(i, 3) * 0.2);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(225,232,220,${0.28 * this.level.fog})`);
        g.addColorStop(1, 'rgba(225,232,220,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    }

    if (this.level.frost > 0.01) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) * 0.55);
      g.addColorStop(0, 'rgba(210,235,255,0)');
      g.addColorStop(1, `rgba(210,235,255,${0.45 * this.level.frost})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    if (this.target?.season === 'fall') {
      const n = Math.min(14, Math.round(8 * area));
      for (let i = 0; i < n; i++) {
        const x = wrap(rnd(i, 1) * w + Math.sin(time * 0.9 + i) * 40 + time * 20, w + 30) - 15;
        const y = wrap(rnd(i, 2) * h + time * (30 + rnd(i, 3) * 30), h + 30) - 15;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(time * 1.2 + i);
        ctx.fillStyle = i % 2 ? 'rgba(196,112,38,0.75)' : 'rgba(150,80,24,0.75)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 6, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(235,240,255,${0.55 * this.flash * this.flash})`;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }
}

const SEASONS: readonly string[] = ['spring', 'summer', 'fall', 'winter'];

/** check a climate message from the commander; null if it is not shaped right */
export function parseClimate(b: Record<string, unknown>): Climate | null {
  if (typeof b.season !== 'string' || !SEASONS.includes(b.season)) return null;
  if (typeof b.weather !== 'string' || !(KINDS as readonly string[]).includes(b.weather)) return null;
  const i = typeof b.intensity === 'number' && Number.isFinite(b.intensity) ? b.intensity : 0.5;
  return { season: b.season as SeasonName, weather: b.weather as Kind, intensity: Math.max(0, Math.min(1, i)) };
}
