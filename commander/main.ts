import { Link, WebSocketTransport } from '../link/client';
import type { Messages } from '../link/protocol';
import { RELAY_PATH } from '../link/relay-path';
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
  if (e.type === 'hero.state') { hero = e.body as Messages['hero.state']; renderPanel(); return; }
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
  link.send('marker', { x, y, label: 'GO' });
  log(`marker ${Math.round(x)}, ${Math.round(y)}`);
  draw();
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc((x / ARENA) * 300, (y / ARENA) * 300, 5, 0, Math.PI * 2);
  ctx.fill();
});
/** the commander's side of the economy: a made-up pool of nutrients that trickles in */
let nutrients = 600;
let hero: Messages['hero.state'] | null = null;
setInterval(() => { nutrients += 15; renderPanel(); }, 1000);

function renderPanel(): void {
  $('panel').hidden = link.state !== 'linked';
  if (link.state !== 'linked') return;
  $('nutrients').textContent = `Nutrients ${Math.floor(nutrients)}`;
  ($('healBtn') as HTMLButtonElement).disabled = !hero || nutrients < 40;
  ($('manaBtn') as HTMLButtonElement).disabled = !hero || nutrients < 30;
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
$('healBtn').addEventListener('click', () => { if (hero && nutrients >= 40) { nutrients -= 40; link.send('supply', { health: 0.4, mana: 0 }); renderPanel(); } });
$('manaBtn').addEventListener('click', () => { if (hero && nutrients >= 30) { nutrients -= 30; link.send('supply', { health: 0, mana: 1 }); renderPanel(); } });

const joinCode = new URLSearchParams(location.search).get('join');
if (joinCode) { $<HTMLInputElement>('code').value = joinCode; void link.join(joinCode).catch(refresh); }
(window as unknown as { __link: Link }).__link = link;
