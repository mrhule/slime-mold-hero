import './style.css';
import { Sfx } from './audio';
import { CHARACTERS } from './characters';
import { Controls } from './input';
import { Renderer, loadImages } from './render';
import { Game, type Enemy, type GameEvent, type Phase } from './sim';
import { Ui, saveBest } from './ui';

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

  const start = (id: string) => {
    charId = id;
    const ch = CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
    game = new Game(ch, Math.floor(Math.random() * 1e9));
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

  const ui = new Ui({
    play: (id) => { sfx.unlock(); start(id); },
    buy: (id) => { if (game?.buy(id)) ui.showShop(game); },
    nextWave: () => { if (game?.phase === 'shop') game.startWave(); },
    retry: () => start(charId),
    menu: () => { game = null; ui.showHud(false); ui.showSelect(); },
    resume: () => setPaused(false),
  });

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
}

main().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;padding:20px">${String(err)}</pre>`);
  throw err;
});
