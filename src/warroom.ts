import type { Messages } from '../link/protocol';
import { TUNING } from './tuning';

type Overview = Messages['overview'];

const W = 560;
const H = 300;

/** pressure 0 (ours) to 1 (the rival's) as a green to red colour */
const heat = (p: number): string => `hsl(${Math.round(120 - 120 * p)} 65% 48%)`;

/**
 * The hero's war table: a stylised board of the fronts, view only. The commander sends `overview` about once a second.
 * It owns its own DOM so the rest of the game does not need to know it exists.
 */
export class WarRoom {
  private readonly btn: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private data: Overview | null = null;
  private open = false;

  constructor() {
    this.btn = document.createElement('button');
    this.btn.id = 'mapBtn';
    this.btn.textContent = '🗺';
    this.btn.setAttribute('aria-label', 'War room map');
    this.btn.hidden = true;
    this.panel = document.createElement('div');
    this.panel.id = 'warroom';
    this.panel.hidden = true;
    document.body.append(this.btn, this.panel);
    this.btn.addEventListener('click', () => this.toggle());
    this.panel.addEventListener('click', () => this.toggle());
  }

  update(o: Overview): void {
    this.data = o;
    this.btn.hidden = false;
    if (this.open) this.draw();
  }

  /** the link is gone: nothing to show */
  clear(): void {
    this.data = null;
    this.open = false;
    this.btn.hidden = true;
    this.panel.hidden = true;
  }

  private toggle(): void {
    if (!this.data) return;
    this.open = !this.open;
    this.panel.hidden = !this.open;
    if (this.open) this.draw();
  }

  private draw(): void {
    const o = this.data;
    if (!o) return;
    const n = Math.max(1, o.fronts.length);
    const home = { x: 70, y: H / 2 };
    const nodes = o.fronts.map((f, i) => {
      const a = n === 1 ? 0 : -0.95 + (1.9 * i) / (n - 1);
      return { f, x: 360 + Math.cos(a) * 150, y: H / 2 + Math.sin(a) * 118 };
    });
    const veins = nodes.map((p) => {
      const mx = (home.x + p.x) / 2;
      return `<path d="M${home.x} ${home.y} Q${mx} ${p.y + (home.y - p.y) * 0.2} ${p.x} ${p.y}" class="vein" style="stroke-width:${3 + (1 - p.f.pressure) * 6}px"/>`;
    }).join('');
    const circles = nodes.map(({ f, x, y }) => {
      const danger = f.pressure >= TUNING.front.dangerPressure;
      const c = 2 * Math.PI * 27;
      return `<g class="${danger ? 'danger' : ''}" transform="translate(${x} ${y})">
        <circle r="23" fill="${heat(f.pressure)}" class="node"/>
        <circle r="27" fill="none" class="pool" stroke-dasharray="${(c * f.pool).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90)"/>
        <text y="6" class="pct">${Math.round(f.pressure * 100)}</text>
        ${f.hero ? '<text y="-32" class="hero">★ YOU</text>' : ''}
        <text y="46" class="lbl">${esc(f.name ?? f.id)}</text></g>`;
    }).join('');
    const trend = o.trend >= 0 ? `+${o.trend.toFixed(1)}` : o.trend.toFixed(1);
    this.panel.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="War room map">
      <rect width="${W}" height="${H}" rx="14" class="table"/>
      <g class="grid">${Array.from({ length: 13 }, (_, i) => `<path d="M${i * 46} 0V${H}"/>`).join('')}${Array.from({ length: 7 }, (_, i) => `<path d="M0 ${i * 46}H${W}"/>`).join('')}</g>
      ${veins}
      <g transform="translate(${home.x} ${home.y})"><circle r="30" class="home"/><text y="6" class="pct">HOME</text></g>
      ${circles}
      <text x="16" y="${H - 14}" class="stat">Territory ${Math.round(o.territory * 100)}%   ·   Nutrients ${trend}/s   ·   Ring = rival nutrients left</text></svg>
      <p>Tap anywhere to close</p>`;
  }
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
