import { Link, WebSocketTransport } from '../link/client';
import type { Messages } from '../link/protocol';
import { RELAY_PATH } from '../link/relay-path';
import { TUNING } from '../src/tuning';
import { UPGRADES, upgradeCost } from '../src/upgrades';

/** A throwaway commander: proves the link end to end before Slime Mold has its own side. */
const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${RELAY_PATH}`;
const link = new Link(() => new WebSocketTransport(url), { role: 'cmd', name: 'Stand-in' });
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $('log');
const log = (s: string) => { logEl.textContent = `${s}\n${logEl.textContent}`.slice(0, 2000); };

const ARENA = 2800; // the hero's dish is 2800 across, centred at (1400, 1400)
const canvas = $<HTMLCanvasElement>('dish');
const ctx = canvas.getContext('2d')!;

function draw(): void {
  ctx.clearRect(0, 0, 300, 300);
  ctx.beginPath();
  ctx.arc(150, 150, 146, 0, Math.PI * 2);
  ctx.fillStyle = '#2a3322';
  ctx.fill();
  ctx.strokeStyle = '#6f7a55';
  ctx.lineWidth = 4;
  ctx.stroke();
}
draw();

const refresh = () => {
  const peers = link.peers.filter((p) => p.id !== link.me?.id).map((p) => `${p.role}${p.online ? '' : ' (away)'}`).join(', ');
  $('status').textContent = link.state === 'solo' ? 'Solo' : `${link.state} · room ${link.code}${peers ? ' · ' + peers : ''}`;
  if (link.error) $('status').textContent += ` · ${link.error}`;
};
link.onState((s) => { log(`state: ${s}`); refresh(); renderPanel(); });
link.onMessage((e) => {
  if (e.type === 'hero.state') {
    hero = e.body as Messages['hero.state'];
    if (hero.harvested < harvested) harvested = 0; // a new game started
    nutrients += hero.harvested - harvested;
    harvested = hero.harvested;
    renderPanel();
    return;
  }
  if (e.type === 'front.progress') { const p = e.body as Messages['front.progress']; if (p.id === front?.id) { nutrients += Math.max(0, p.bounty - front.bounty); front.bounty = p.bounty; front.progress = p; renderPanel(); } return; }
  if (e.type === 'front.result') { const r = e.body as Messages['front.result']; log(`front ${r.id}: ${r.outcome}, ${r.kills} kills`); if (r.id === front?.id) { front.outcome = r.outcome; nutrients += r.loot.goo; tech += r.loot.tech; log(`loot: ${r.loot.nutrients} nutrients earned, ${r.loot.goo} goo, ${r.loot.tech} tech`); renderPanel(); } return; }
  if (e.type === 'pong') log(`pong ${Math.round(performance.now() - (e.body as { t: number }).t)} ms`);
  else log(`${e.role} sent ${e.type}`);
});

$('host').addEventListener('click', () => link.host().then((c) => log(`hosting ${c}`)).catch(refresh));
$('join').addEventListener('click', () => link.join($<HTMLInputElement>('code').value).catch(refresh));
$('leave').addEventListener('click', () => { link.leave(); refresh(); });
$('ping').addEventListener('click', () => link.send('ping', { t: performance.now() }));
canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * ARENA;
  const y = ((e.clientY - r.top) / r.height) * ARENA;
  if (strikeMode()) {
    if (nutrients < TUNING.strike.cost || performance.now() < strikeReady) return log('strike not ready');
    nutrients -= TUNING.strike.cost;
    strikeReady = performance.now() + TUNING.strike.cooldown * 1000;
    link.send('strike', { x, y });
    log(`strike ${Math.round(x)}, ${Math.round(y)}`);
  } else {
    link.send('marker', { x, y, label: 'GO' });
    log(`marker ${Math.round(x)}, ${Math.round(y)}`);
  }
  draw();
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc((x / ARENA) * 300, (y / ARENA) * 300, 5, 0, Math.PI * 2);
  ctx.fill();
});
let strikeReady = 0;
const strikeMode = (): boolean => $<HTMLInputElement>('strikeMode').checked;

/** the commander's side of the economy: a made-up pool of nutrients that trickles in */
let nutrients = 600;
let hero: Messages['hero.state'] | null = null;
/** an open front costs the commander too: nutrients drain every second until it is decided; at zero the front collapses */
let fronts = 0;
let tech = 0;
/** the hero's running harvest total we have already been paid for */
let harvested = 0;
let front: { id: string; progress: Messages['front.progress'] | null; outcome: string | null; bounty: number } | null = null;
setInterval(() => {
  nutrients += 15;
  sendOverview();
  sendClimate();
  if (front && !front.outcome) {
    nutrients = Math.max(0, nutrients - TUNING.front.drainPerSecond);
    if (nutrients === 0) { link.send('front.recall', { id: front.id }); log('out of nutrients: the front collapses'); }
  }
  renderPanel();
}, 1000);

/** what the hero's war-room map shows: the open front is real, the others drift on their own */
const others = [{ id: 'N', name: 'North vein', pressure: 0.35, pool: 0.8 }, { id: 'S', name: 'South marsh', pressure: 0.6, pool: 0.5 }];
/** the stand-in decides the weather from two drop-downs; the real commander uses its own climate */
function sendClimate(): void {
  if (link.state !== 'linked') return;
  link.send('climate', { season: $<HTMLSelectElement>('season').value as Messages['climate']['season'], weather: $<HTMLSelectElement>('weather').value as Messages['climate']['weather'], intensity: 0.8 });
}
$('season').addEventListener('change', sendClimate);
$('weather').addEventListener('change', sendClimate);

function sendOverview(): void {
  if (link.state !== 'linked') return;
  for (const o of others) o.pressure = Math.max(0.05, Math.min(0.95, o.pressure + (Math.random() - 0.5) * 0.08));
  const open = front && !front.outcome ? front : null;
  const list = [
    ...others.map((o) => ({ ...o, hero: false })),
    ...(open ? [{ id: open.id, name: 'Front ' + open.id, pressure: open.progress?.pressure ?? 0.5, pool: open.progress?.pool ?? 1, hero: true }] : []),
  ];
  link.send('overview', { fronts: list, territory: 0.45, trend: 15 - (open ? TUNING.front.drainPerSecond : 0) });
}

function renderPanel(): void {
  $('panel').hidden = link.state !== 'linked';
  if (link.state !== 'linked') return;
  $('nutrients').textContent = `Nutrients ${Math.floor(nutrients)} · Tech ${tech}`;
  ($('healBtn') as HTMLButtonElement).disabled = !hero || nutrients < TUNING.supply.healCost;
  ($('manaBtn') as HTMLButtonElement).disabled = !hero || nutrients < TUNING.supply.manaCost;
  const open = !!front && !front.outcome;
  ($('frontBtn') as HTMLButtonElement).disabled = open; // a hero waiting on the title screen can be deployed too
  ($('recallBtn') as HTMLButtonElement).disabled = !open;
  const p = front?.progress;
  $('frontInfo').textContent = !front ? 'No front open' : front.outcome ? `${front.id}: ${front.outcome}` : p ? `${front.id} · wave ${p.wave} · ${p.kills} kills · rival has ${Math.round(p.pool * 100)}%` : `${front.id} · deploying…`;
  $('pressBar').style.width = `${(p?.pressure ?? 0) * 100}%`;
  $('pressTxt').textContent = p && open ? `Pressure ${Math.round(p.pressure * 100)}%${p.pressure > 0.7 ? ' · DANGER' : ''}` : '';
  if (!hero) { $('heroInfo').textContent = 'Waiting for the hero…'; return; }
  $('heroInfo').textContent = `${hero.mold} · wave ${hero.wave}`;
  $('hpBar').style.width = `${(hero.hp / hero.maxHp) * 100}%`;
  $('hpTxt').textContent = `HP ${hero.hp} / ${hero.maxHp}`;
  $('manaBar').style.width = `${(hero.mana / hero.maxMana) * 100}%`;
  $('manaTxt').textContent = `Mana ${hero.mana} / ${hero.maxMana}`;
  $('ups').innerHTML = UPGRADES.map((u) => {
    const lv = hero!.levels[u.id] ?? 0;
    const cost = lv >= u.max ? null : upgradeCost(u, lv);
    const dis = cost === null || nutrients < cost ? 'disabled' : '';
    return `<div class="up"><span>${u.icon} ${u.name} <small>${lv}/${u.max}</small></span><button data-up="${u.id}" ${dis}>${cost === null ? 'MAX' : cost}</button></div>`;
  }).join('');
}

/** the commander pays first, then tells the hero */
$('ups').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-up]')?.dataset.up;
  const def = UPGRADES.find((u) => u.id === id);
  if (!hero || !def) return;
  const lv = hero.levels[def.id] ?? 0;
  if (lv >= def.max || nutrients < upgradeCost(def, lv)) return;
  nutrients -= upgradeCost(def, lv);
  hero.levels[def.id] = lv + 1;
  link.send('upgrade', { mold: hero.mold, id: def.id, level: lv + 1 });
  renderPanel();
});
$('frontBtn').addEventListener('click', () => {
  front = { id: `F${++fronts}`, progress: null, outcome: null, bounty: 0 };
  link.send('front.open', { id: front.id, seed: Math.floor(Math.random() * 1e9), pool: 60, tier: 1, pressure: 0.5 });
  renderPanel();
});
$('recallBtn').addEventListener('click', () => { if (front) link.send('front.recall', { id: front.id }); });
$('healBtn').addEventListener('click', () => { if (hero && nutrients >= TUNING.supply.healCost) { nutrients -= TUNING.supply.healCost; link.send('supply', { health: TUNING.supply.healFraction, mana: 0 }); renderPanel(); } });
$('manaBtn').addEventListener('click', () => { if (hero && nutrients >= TUNING.supply.manaCost) { nutrients -= TUNING.supply.manaCost; link.send('supply', { health: 0, mana: 1 }); renderPanel(); } });

const joinCode = new URLSearchParams(location.search).get('join');
if (joinCode) { $<HTMLInputElement>('code').value = joinCode; void link.join(joinCode).catch(refresh); }
(window as unknown as { __link: Link }).__link = link;
