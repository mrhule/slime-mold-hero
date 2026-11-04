import { CHARACTERS, type CharacterDef } from './characters';
import { UPGRADES, type Levels } from './upgrades';
import type { Game } from './sim';

export interface UiHandlers {
  play(charId: string): void;
  buy(id: string): void;
  nextWave(): void;
  retry(): void;
  menu(): void;
  resume(): void;
  coop(): void;
  coopHost(): void;
  coopJoin(code: string): void;
  coopLeave(): void;
  coopBack(): void;
  /** serverless pairing: the host makes an invite, the guest pastes it and replies, the host pastes the reply */
  pairHost(): void;
  pairJoinStart(): void;
  pairAccept(answer: string): void;
  pairJoin(offer: string): void;
  pairCancel(): void;
  /** the host changed the other game's address that the QR code opens */
  coopPeer(url: string): void;
}

/** what the serverless pairing screen shows */
export interface PairInfo {
  mode: 'host' | 'join';
  /** the host's block, once made */
  offer: string | null;
  /** the guest's reply block, once made */
  answer: string | null;
  busy: boolean;
  error: string | null;
}

export interface CoopInfo {
  /** QR code (inline SVG) that opens the other game and joins this room; null if there is no usable address */
  qr?: string | null;
  /** the other game's address the QR code points at */
  peer?: string;
  /** this page was opened as localhost, which another device cannot reach */
  localhost?: boolean;
  state: 'solo' | 'hosting' | 'linked' | 'dropped';
  code: string | null;
  peers: { role: string; name: string; online: boolean }[];
  error: string | null;
  busy: boolean;
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
  private linkLabel = '';
  private medalKey = '';
  coopShown = false;

  constructor(private h: UiHandlers) {
    try { this.selected = localStorage.getItem('sms-char') ?? this.selected; } catch { /* ignore */ }
    this.overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).id === 'codeIn') this.overlay.querySelector<HTMLElement>('[data-action=coop-join]')?.click();
    });
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
        case 'coop': this.h.coop(); break;
        case 'coop-host': this.h.coopHost(); break;
        case 'coop-join': this.h.coopJoin((this.overlay.querySelector<HTMLInputElement>('#codeIn')?.value ?? '').trim()); break;
        case 'coop-leave': this.h.coopLeave(); break;
        case 'coop-back': this.h.coopBack(); break;
        case 'pair-host': this.h.pairHost(); break;
        case 'pair-join-start': this.h.pairJoinStart(); break;
        case 'pair-accept': this.h.pairAccept(this.overlay.querySelector<HTMLTextAreaElement>('#pairIn')?.value ?? ''); break;
        case 'pair-join': this.h.pairJoin(this.overlay.querySelector<HTMLTextAreaElement>('#pairIn')?.value ?? ''); break;
        case 'pair-cancel': this.h.pairCancel(); break;
        case 'pair-copy': {
          const box = this.overlay.querySelector<HTMLTextAreaElement>('#pairOut');
          if (box) {
            box.select();
            // the clipboard API needs https; a page opened from the LAN over http falls back to the old way
            const done = navigator.clipboard?.writeText(box.value);
            if (done) done.catch(() => document.execCommand('copy'));
            else document.execCommand('copy');
          }
          break;
        }
      }
    });
  }

  hide(): void {
    this.overlay.hidden = true;
    this.overlay.innerHTML = '';
    document.body.classList.remove('menu');
  }

  private show(html: string): void {
    this.coopShown = false;
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
        <button data-action="coop">Co-op${this.linkLabel ? ' · ' + this.linkLabel : ''}</button>
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
        <button data-action="coop">Co-op${this.linkLabel ? ' · ' + this.linkLabel : ''}</button>
        <button data-action="menu">Quit to mold select</button>
      </div>`);
  }

  /** short status for the HUD pill and the Co-op buttons; null when solo */
  setLink(text: string | null): void {
    this.linkLabel = text ?? '';
    const pill = $('linkPill');
    pill.hidden = !text;
    pill.textContent = text ?? '';
  }

  showCoop(info: CoopInfo): void {
    const peers = info.peers.map((p) => `<li>${p.online ? '●' : '○'} ${p.role === 'cmd' ? 'Commander' : 'Hero'} (${p.name})${p.online ? '' : ' · reconnecting'}</li>`).join('');
    let body: string;
    if (info.state === 'solo') {
      body = `
        <p class="sub">Play with a commander on another device on the same Wi-Fi.</p>
        <button class="big" data-action="coop-host" ${info.busy ? 'disabled' : ''}>Host a room</button>
        <div class="join"><input id="codeIn" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false"><button data-action="coop-join" ${info.busy ? 'disabled' : ''}>Join</button></div>
        <p class="sub">No server on this network? Pair by copy and paste.</p>
        <div class="join"><button data-action="pair-host">Host by paste</button><button data-action="pair-join-start">Join by paste</button></div>`;
    } else if (info.state === 'hosting') {
      body = `
        <p class="sub">Scan this with the other device's camera, or give them the code.</p>
        ${info.qr ? `<div class="qrbox">${info.qr}</div>` : ''}
        <div class="code small">${info.code}</div>
        ${info.localhost ? `<p class="err">This page is open as localhost, so another device cannot reach it. Open it by the network address of this computer instead.</p>` : ''}
        <label class="peer">Other game's address <input id="peerIn" value="${(info.peer ?? '').replace(/"/g, '&quot;')}" spellcheck="false" autocapitalize="off"></label>
        <p class="sub">Waiting for them to join. You can keep playing.</p>
        <button data-action="coop-leave">Cancel</button>`;
    } else {
      body = `
        <div class="code small">${info.code}</div>
        <ul class="peers">${peers}</ul>
        <p class="sub">${info.state === 'dropped' ? 'The link is down. Trying to reconnect, and play carries on meanwhile.' : 'Linked.'}</p>
        <button data-action="coop-leave">Leave</button>`;
    }
    this.show(`
      <div class="screen coop">
        <h1>Co-op</h1>
        ${body}
        ${info.error ? `<p class="err">${info.error}</p>` : ''}
        <button data-action="coop-back">Back</button>
      </div>`);
    this.coopShown = true;
    this.overlay.querySelector('#peerIn')?.addEventListener('change', (e) => this.h.coopPeer((e.target as HTMLInputElement).value.trim()));
  }

  /** serverless pairing screen. Text boxes keep what is typed, so call it only when the step changes. */
  showPair(p: PairInfo): void {
    const out = (label: string, text: string) =>
      `<p class="sub">${label}</p><textarea id="pairOut" readonly rows="4">${text}</textarea><button data-action="pair-copy">Copy</button>`;
    let body: string;
    if (p.mode === 'host') {
      body = p.offer
        ? `${out('1. Send this to the other device, any way you like.', p.offer)}
           <p class="sub">2. Paste the reply it gives you.</p>
           <textarea id="pairIn" rows="3" placeholder="Paste the reply" spellcheck="false"></textarea>
           <button class="big" data-action="pair-accept" ${p.busy ? 'disabled' : ''}>Connect</button>`
        : '<p class="sub">Preparing…</p>';
    } else if (p.answer) {
      body = `${out('Send this reply back to the host. It connects when they paste it.', p.answer)}<p class="sub">Waiting for the host…</p>`;
    } else {
      body = `<p class="sub">Paste the block from the host device.</p>
        <textarea id="pairIn" rows="4" placeholder="Paste the host block" spellcheck="false"></textarea>
        <button class="big" data-action="pair-join" ${p.busy ? 'disabled' : ''}>Make reply</button>`;
    }
    this.show(`<div class="screen coop pair"><h1>Pair by paste</h1>${body}${p.error ? `<p class="err">${p.error}</p>` : ''}<button data-action="pair-cancel">Cancel</button></div>`);
    this.coopShown = false;
  }

  banner(text: string, boss = false): void {
    const el = $<HTMLDivElement>('banner');
    el.textContent = text;
    el.className = `show ${boss ? 'boss' : ''}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (el.className = ''), 1800);
  }

  /** upgrades shown as medals on the hero, so its growth is visible */
  private medals(levels: Levels): void {
    const key = UPGRADES.map((u) => levels[u.id] ?? 0).join(',');
    if (key === this.medalKey) return;
    this.medalKey = key;
    $('medals').innerHTML = UPGRADES.filter((u) => (levels[u.id] ?? 0) > 0)
      .map((u) => `<span class="medal" title="${u.name}">${u.icon}<b>${levels[u.id]}</b></span>`).join('');
  }

  hud(game: Game): void {
    this.medals(game.levels);
    const s = game.stats;
    const p = game.player;
    $('hpFill').style.width = `${(p.hp / s.maxHp) * 100}%`;
    $('hpText').textContent = `${Math.ceil(p.hp)} / ${s.maxHp}`;
    $('manaFill').style.width = `${(p.mana / s.maxMana) * 100}%`;
    $('manaText').textContent = `${Math.floor(p.mana)} / ${s.maxMana}`;
    $('waveNum').textContent = game.roaming ? 'ROAMING' : `WAVE ${game.wave}`;
    $('waveLeft').textContent = game.roaming ? `🌿 ${game.harvested} harvested` : game.phase === 'wave' ? `${game.enemiesLeft} left` : 'clear!';
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
