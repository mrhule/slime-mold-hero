import { CHARACTERS, type CharacterDef } from './characters';
import { UPGRADES } from './upgrades';
import type { Game } from './sim';

export interface UiHandlers {
  play(charId: string): void;
  buy(id: string): void;
  nextWave(): void;
  retry(): void;
  menu(): void;
  resume(): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function bar(value: number, max: number): string {
  return `<span class="mini"><i style="width:${Math.round(Math.min(1, value / max) * 100)}%"></i></span>`;
}

export function loadBest(key: string): number {
  try { return Number(localStorage.getItem(`sms-best-${key}`)) || 0; } catch { return 0; }
}
export function saveBest(key: string, wave: number): void {
  try { if (wave > loadBest(key)) localStorage.setItem(`sms-best-${key}`, String(wave)); } catch { /* storage unavailable */ }
}

export class Ui {
  private overlay = $<HTMLDivElement>('overlay');
  private hudEl = $<HTMLDivElement>('hud');
  private selected = 'general-goo';
  private bannerTimer = 0;

  constructor(private h: UiHandlers) {
    try { this.selected = localStorage.getItem('sms-char') ?? this.selected; } catch { /* ignore */ }
    this.overlay.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!el || el.hasAttribute('disabled')) return;
      const id = el.dataset.id ?? '';
      switch (el.dataset.action) {
        case 'select':
          if (CHARACTERS.find((c) => c.id === id && !c.locked)) { this.selected = id; this.showSelect(); }
          break;
        case 'play':
          try { localStorage.setItem('sms-char', this.selected); } catch { /* ignore */ }
          this.h.play(this.selected);
          break;
        case 'buy': this.h.buy(id); break;
        case 'next': this.h.nextWave(); break;
        case 'retry': this.h.retry(); break;
        case 'menu': this.h.menu(); break;
        case 'resume': this.h.resume(); break;
      }
    });
  }

  hide(): void {
    this.overlay.hidden = true;
    this.overlay.innerHTML = '';
    document.body.classList.remove('menu');
  }

  private show(html: string): void {
    this.overlay.hidden = false;
    this.overlay.innerHTML = html;
    document.body.classList.add('menu');
  }

  showHud(on: boolean): void {
    this.hudEl.hidden = !on;
  }

  showSelect(): void {
    const cards = CHARACTERS.map((c) => this.card(c)).join('');
    const sel = CHARACTERS.find((c) => c.id === this.selected) ?? CHARACTERS[0];
    this.show(`
      <div class="screen select">
        <h1>Slime Mold: <em>Hero</em></h1>
        <p class="sub">Pick your mold. Hold off the rival colonies for as long as you can.</p>
        <div class="cards">${cards}</div>
        <div class="how">
          <span class="kb"><b>WASD</b> move &nbsp; <b>Left mouse</b> shoot &nbsp; <b>Right mouse</b> cast ${sel.spell.name} &nbsp; <b>Esc</b> pause &nbsp; <b>M</b> mute</span><span class="tc"><b>Left thumb</b> move &nbsp; <b>Right thumb</b> drag to aim and shoot &nbsp; <b>✦ button</b> cast ${sel.spell.name}</span>
        </div>
        <button class="big" data-action="play">Play as ${sel.name}</button>
        <p class="best">Best wave with ${sel.name}: ${loadBest(sel.id)}</p>
      </div>`);
  }

  private card(c: CharacterDef): string {
    const s = c.stats;
    return `
      <div class="card ${c.locked ? 'locked' : ''} ${c.id === this.selected ? 'on' : ''}" data-action="select" data-id="${c.id}">
        <div class="portrait"><img src="art/${c.portrait}.webp" alt=""></div>
        <h3>${c.name}</h3>
        <small>${c.title}</small>
        ${c.locked ? '<p class="soon">Coming soon</p>' : `
          <p>${c.blurb}</p>
          <div class="stat"><label>Health</label>${bar(s.maxHp, 170)}</div>
          <div class="stat"><label>Speed</label>${bar(s.speed, 260)}</div>
          <div class="stat"><label>Mana</label>${bar(s.maxMana, 150)}</div>
          <div class="kit"><b>${c.weapon.name}</b> · <b>${c.spell.name}</b></div>`}
      </div>`;
  }

  showShop(game: Game): void {
    const scroll = this.overlay.querySelector('.cards')?.scrollTop ?? 0;
    const s = game.stats;
    const cards = UPGRADES.map((u) => {
      const lv = game.levels[u.id] ?? 0;
      const cost = game.nextCost(u.id);
      const can = cost !== null && game.player.gold >= cost;
      const pips = Array.from({ length: u.max }, (_, i) => `<i class="${i < lv ? 'f' : ''}"></i>`).join('');
      return `
        <div class="up">
          <div class="icon">${u.icon}</div>
          <div class="txt"><h4>${u.name} <small>Lv ${lv}/${u.max}</small></h4><p>${u.blurb}</p><div class="pips">${pips}</div></div>
          <button data-action="buy" data-id="${u.id}" ${can ? '' : 'disabled'}>${cost === null ? 'MAX' : `🟡 ${cost}`}</button>
        </div>`;
    }).join('');
    this.show(`
      <div class="screen shop">
        <header>
          <div><h2>Wave ${game.wave} cleared</h2><small>+${game.lastClearBonus} goo bonus · ${game.kills} slimes squashed</small></div>
          <div class="wallet">🟡 ${game.player.gold}</div>
        </header>
        <div class="statline">
          <span>❤️ ${Math.round(game.player.hp)}/${s.maxHp}</span><span>🌱 ${s.regen.toFixed(1)}/s</span>
          <span>🛡️ ${s.armor} (${Math.round(s.reduction * 100)}%)</span><span>💥 ${(s.weapon.damage * s.strength).toFixed(1)} ×${s.weapon.pellets}</span>
          <span>🔫 ${s.weapon.rate.toFixed(1)}/s</span><span>🔮 ${Math.round(s.spell.damage)} dmg · ${s.spell.cooldown.toFixed(1)}s</span>
          <span>💧 ${s.maxMana}</span><span>👟 ${Math.round(s.speed)}</span>
        </div>
        <div class="ups">${cards}</div>
        <button class="big" data-action="next">Start wave ${game.wave + 1} <small class="kb">(Enter)</small></button>
      </div>`);
    const ups = this.overlay.querySelector('.ups');
    if (ups) ups.scrollTop = scroll;
  }

  showDead(game: Game): void {
    const best = loadBest(game.ch.id);
    this.show(`
      <div class="screen dead">
        <h1>Squashed!</h1>
        <p class="sub">${game.ch.name} fell on wave ${game.wave}.</p>
        <div class="results"><div><b>${game.wave}</b><small>wave</small></div><div><b>${game.kills}</b><small>kills</small></div><div><b>${game.goldEarned}</b><small>goo</small></div></div>
        <p class="best">Best wave: ${best}</p>
        <button class="big" data-action="retry">Try again</button>
        <button data-action="menu">Change mold</button>
      </div>`);
  }

  showPause(): void {
    this.show(`
      <div class="screen pause">
        <h1>Paused</h1>
        <button class="big" data-action="resume">Resume</button>
        <button data-action="menu">Quit to mold select</button>
      </div>`);
  }

  banner(text: string, boss = false): void {
    const el = $<HTMLDivElement>('banner');
    el.textContent = text;
    el.className = `show ${boss ? 'boss' : ''}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (el.className = ''), 1800);
  }

  hud(game: Game): void {
    const s = game.stats;
    const p = game.player;
    $('hpFill').style.width = `${(p.hp / s.maxHp) * 100}%`;
    $('hpText').textContent = `${Math.ceil(p.hp)} / ${s.maxHp}`;
    $('manaFill').style.width = `${(p.mana / s.maxMana) * 100}%`;
    $('manaText').textContent = `${Math.floor(p.mana)} / ${s.maxMana}`;
    $('waveNum').textContent = `WAVE ${game.wave}`;
    $('waveLeft').textContent = game.phase === 'wave' ? `${game.enemiesLeft} left` : 'clear!';
    $('gold').textContent = `🟡 ${p.gold}`;
    const cd = Math.max(0, p.castCd) / s.spell.cooldown;
    const ready = p.castCd <= 0 && p.mana >= s.spell.cost;
    const icon = $('spellIcon');
    icon.style.setProperty('--cd', `${cd * 360}deg`);
    icon.className = ready ? 'ready' : p.mana < s.spell.cost ? 'nomana' : '';
    $('spellName').textContent = `${s.spell.name} · ${Math.round(s.spell.cost)} mana`;
    const boss = game.boss;
    const bar = $('bossBar');
    bar.hidden = !boss;
    if (boss) $('bossFill').style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`;
    $('hpFill').classList.toggle('low', p.hp / s.maxHp < 0.3);
  }
}
