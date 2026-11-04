import { TUNING, loadTuning, resetTuning, saveTuning } from './tuning';

/** a small ring of things that happened, kept for playtests: `__log()` in the console, or Download in the panel */
export interface LogEntry { t: number; type: string; data?: unknown }

const LIMIT = 500;
const entries: LogEntry[] = [];
const t0 = performance.now();

export function dlog(type: string, data?: unknown): void {
  entries.push({ t: Math.round(performance.now() - t0) / 1000, type, data });
  if (entries.length > LIMIT) entries.shift();
}

export const logEntries = (): readonly LogEntry[] => entries;

function download(): void {
  const blob = new Blob([JSON.stringify({ tuning: TUNING, log: entries }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `slime-hero-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** numeric leaves of the tuning object as [path, value] */
function leaves(o: Record<string, unknown>, prefix = ''): [string, number][] {
  return Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'number' ? [[prefix + k, v] as [string, number]] : v && typeof v === 'object' ? leaves(v as Record<string, unknown>, `${prefix}${k}.`) : []);
}

function setPath(path: string, value: number): void {
  const parts = path.split('.');
  let o = TUNING as unknown as Record<string, unknown>;
  for (const p of parts.slice(0, -1)) o = o[p] as Record<string, unknown>;
  o[parts[parts.length - 1]] = value;
}

/** The playtest panel. F2 or ?debug opens it. Edits apply at once and Save keeps them in this browser. */
export function setupDebug(state: () => string): void {
  loadTuning();
  (window as unknown as { __log: () => readonly LogEntry[] }).__log = logEntries;

  const el = document.createElement('div');
  el.id = 'debugPanel';
  el.hidden = true;
  document.body.appendChild(el);

  const render = (): void => {
    const rows = leaves(TUNING as unknown as Record<string, unknown>)
      .map(([k, v]) => `<label><span>${k}</span><input type="number" step="any" data-k="${k}" value="${v}"></label>`)
      .join('');
    el.innerHTML = `<div class="dbTop"><b>Tuning</b><button data-a="save">Save</button><button data-a="reset">Reset</button><button data-a="log">Download log</button><button data-a="close">×</button></div>
      <pre id="dbState"></pre><div class="dbRows">${rows}</div><pre id="dbLog"></pre>`;
  };
  render();

  el.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const k = input.dataset.k;
    const v = parseFloat(input.value);
    if (k && Number.isFinite(v)) { setPath(k, v); dlog('tune', { [k]: v }); }
  });
  el.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).dataset.a;
    if (a === 'save') saveTuning();
    else if (a === 'reset') { resetTuning(); render(); }
    else if (a === 'log') download();
    else if (a === 'close') el.hidden = true;
  });
  // keys typed in the panel must not steer the hero
  el.addEventListener('keydown', (e) => e.stopPropagation());

  const toggle = (): void => { el.hidden = !el.hidden; };
  window.addEventListener('keydown', (e) => { if (e.code === 'F2') { e.preventDefault(); toggle(); } });
  if (new URLSearchParams(location.search).has('debug')) el.hidden = false;

  setInterval(() => {
    if (el.hidden) return;
    const s = el.querySelector('#dbState');
    const l = el.querySelector('#dbLog');
    if (s) s.textContent = state();
    if (l) l.textContent = entries.slice(-12).map((x) => `${x.t.toFixed(1)}s ${x.type} ${x.data === undefined ? '' : JSON.stringify(x.data)}`).join('\n');
  }, 500);
}
