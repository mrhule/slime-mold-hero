import './style.css';
import { Sfx } from './audio';
import { CHARACTERS } from './characters';
import { frontProgress, handleEnvelope, heroState, makeLink, type MoldLevels } from './coop';
import { Controls } from './input';
import { Renderer, loadImages } from './render';
import { Game, type Enemy, type FrontSpec, type FrontState, type GameEvent, type Phase } from './sim';
import { Ui, saveBest, type CoopInfo } from './ui';

async function main(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const loading = document.getElementById('loading')!;
  const images = await loadImages();
  loading.remove();

  const sfx = new Sfx();
  const renderer = new Renderer(canvas, images);
  let game: Game | null = null;
  let charId = '';
  let paused = false;
  let shown: Phase | null = null;
  let deadTimer = 0;

  const playing = () => !!game && (game.phase === 'wave' || game.phase === 'clear');
  const setPaused = (on: boolean) => {
    if (!playing() || paused === on) return;
    paused = on;
    if (on) { controls.release(); ui.showPause(); } else ui.hide();
  };

  const start = (id: string, front?: FrontSpec) => {
    charId = id;
    const ch = CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
    game = new Game(ch, front?.seed ?? Math.floor(Math.random() * 1e9), isLinked() ? molds[id] : undefined);
    game.linked = isLinked();
    if (front) game.openFront(front);
    game.onEvent = onEvent;
    renderer.reset(game);
    paused = false;
    shown = null;
    deadTimer = 0;
    ui.showHud(true);
    ui.hide();
    game.startWave();
    if (controls.touchMode) void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const onEvent = (e: GameEvent) => {
    sfx.play(e);
    if (!game) return;
    if (e === 'waveStart') {
      renderer.fadeDecals();
      const boss = game.wave % 5 === 0;
      ui.banner(boss ? `WAVE ${game.wave} · BOSS!` : `WAVE ${game.wave}`, boss);
    }
  };

  const ui: Ui = new Ui({
    play: (id) => { sfx.unlock(); start(id); },
    buy: (id) => { if (game?.buy(id)) ui.showShop(game); },
    nextWave: () => { if (game?.phase === 'shop') game.startWave(); },
    retry: () => start(charId),
    menu: () => { game = null; ui.showHud(false); ui.showSelect(); },
    resume: () => setPaused(false),
    coop: () => showCoop(),
    coopHost: () => {
      busy = true;
      showCoop();
      link.host().catch(() => {}).finally(() => { busy = false; showCoop(); });
    },
    coopJoin: (code) => {
      if (code.length < 4) { joinError = 'Enter the 4 letter code'; return showCoop(); }
      busy = true;
      joinError = null;
      showCoop();
      link.join(code).catch(() => {}).finally(() => { busy = false; showCoop(); });
    },
    coopLeave: () => { link.leave(); showCoop(); },
    coopBack: () => {
      joinError = null;
      if (!game) ui.showSelect();
      else if (paused) ui.showPause();
      else ui.hide();
    },
  });

  // ---- co-op link: this game plays the hero. It works alone, and the link only adds things.
  const link = makeLink();
  let busy = false;
  let joinError: string | null = null;
  const coopInfo = (): CoopInfo => ({
    state: link.state,
    code: link.code,
    peers: link.peers.map((p) => ({ role: p.role, name: p.name, online: p.online })),
    error: joinError ?? link.error,
    busy,
  });
  const showCoop = (): void => ui.showCoop(coopInfo());
  const linkText = (): string | null => {
    switch (link.state) {
      case 'hosting': return `Room ${link.code}`;
      case 'linked': return 'Linked to commander';
      case 'dropped': return 'Reconnecting…';
      default: return null;
    }
  };
  link.onState(() => {
    syncLinked();
    ui.setLink(linkText());
    if (ui.coopShown) showCoop();
  });
  // while linked the commander buys upgrades and supplies the hero: no shop, no goo
  const molds: MoldLevels = {};
  const isLinked = () => link.state === 'linked' || link.state === 'dropped';
  const report = () => {
    if (!game || link.state !== 'linked') return;
    link.send('hero.state', heroState(game));
    const p = frontProgress(game);
    if (p) link.send('front.progress', p);
  };
  // a front is decided once: tell the commander, and send the hero back to the title when it was won or recalled
  let settled: FrontState | null = null;
  const settleFront = () => {
    const f = game?.front;
    if (!game || !f?.result || settled === f) return;
    settled = f;
    if (link.state === 'linked') link.send('front.result', { id: f.spec.id, outcome: f.result, kills: game.kills });
    if (f.result === 'lost') return;
    ui.banner(f.result === 'won' ? 'FRONT HELD' : 'RECALLED', f.result === 'won');
    setTimeout(() => { if (game?.front === f) { game = null; ui.showHud(false); ui.showSelect(); } }, 2500);
  };
  const syncLinked = () => {
    document.body.classList.toggle('linked', isLinked());
    if (game) game.linked = isLinked();
    if (link.state === 'solo') for (const k of Object.keys(molds)) delete molds[k];
    if (link.state === 'linked' && game) { molds[game.ch.id] = { ...game.levels }; report(); }
  };
  link.onMessage((e) => { if (handleEnvelope(e, { game, molds, openFront: (spec) => start(charId || CHARACTERS[0].id, spec), send: (t, b) => link.send(t, b) })) report(); });
  setInterval(() => { settleFront(); report(); }, 1000);
  window.addEventListener('beforeunload', () => link.leave());

  const controls = new Controls(
    canvas,
    (code) => {
      sfx.unlock();
      if (code === 'KeyM') sfx.muted = !sfx.muted;
      if (!game) return;
      if ((code === 'Enter' || code === 'Space') && game.phase === 'shop') game.startWave();
      if (code === 'Escape' || code === 'KeyP') setPaused(!paused);
    },
    (touch) => {
      document.body.classList.toggle('touch', touch);
      renderer.touchMode = touch;
      renderer.resize();
    },
  );
  document.addEventListener('pointerdown', () => sfx.unlock(), { passive: true });
  document.getElementById('pauseBtn')!.addEventListener('click', () => setPaused(!paused));
  window.addEventListener('blur', () => setPaused(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
  window.addEventListener('resize', () => renderer.resize());

  ui.showSelect();
  ui.showHud(false);

  // a commander (or a QR code) can open this page with ?join=CODE to link straight away
  const joinCode = new URLSearchParams(location.search).get('join');
  if (joinCode) {
    busy = true;
    link.join(joinCode).catch(() => { joinError = link.error; showCoop(); }).finally(() => { busy = false; });
  }

  const nearest = (g: Game, range: number): Enemy | null => {
    let best: Enemy | null = null;
    let bd = range;
    for (const e of g.enemies) {
      if (e.hp <= 0 || e.spawnT > 0) continue;
      const d = Math.hypot(e.x - g.player.x, e.y - g.player.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    renderer.mouse = controls.mouse;
    renderer.sticks = controls.sticks();
    if (game) {
      const portraitTouch = controls.touchMode && window.innerHeight > window.innerWidth;
      if (!paused && !portraitTouch) {
        const near = nearest(game, 700);
        const fallback = near ? Math.atan2(near.y - game.player.y, near.x - game.player.x) : null;
        const input = controls.read((x, y) => renderer.screenToWorld(x, y), game.player, fallback);
        if (controls.touchMode) {
          // the spell goes at the nearest enemy in range; the preview ring follows the same point
          const target = input.cast ? nearest(game, 520) : null;
          if (target) { input.aimX = target.x; input.aimY = target.y; }
          renderer.aimWorld = { x: input.aimX, y: input.aimY };
        } else {
          renderer.aimWorld = null;
        }
        const steps = dt > 1 / 30 ? 2 : 1;
        for (let i = 0; i < steps; i++) game.update(dt / steps, input);
        if (game.phase !== shown) {
          shown = game.phase;
          if (shown === 'shop') ui.showShop(game);
          if (shown === 'wave') ui.hide();
          if (shown === 'dead') { saveBest(game.ch.id, game.wave); deadTimer = 1.4; }
        }
        if (deadTimer > 0) {
          deadTimer -= dt;
          if (deadTimer <= 0 && game.phase === 'dead') ui.showDead(game);
        }
      }
      settleFront();
      renderer.draw(game);
      ui.hud(game);
    } else {
      renderer.ctx.fillStyle = '#080a07';
      renderer.ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Handy for debugging and automated playtests.
  (window as unknown as { __game: () => Game | null }).__game = () => game;
  (window as unknown as { __renderer: Renderer }).__renderer = renderer;
  (window as unknown as { __controls: Controls }).__controls = controls;
  (window as unknown as { __link: typeof link }).__link = link;
}

main().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;padding:20px">${String(err)}</pre>`);
  throw err;
});
