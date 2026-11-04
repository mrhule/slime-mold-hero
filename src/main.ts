import './style.css';
import { Sfx } from './audio';
import { CHARACTERS } from './characters';
import { deadTransport, reply, RtcHub, type Invite } from '../link/rtc';
import { defaultPeer, frontProgress, handleEnvelope, heroState, joinUrl, makeLink, relayTransport, savePeer, type MoldLevels } from './coop';
import { qrSvg } from './qr';
import { Controls } from './input';
import { Renderer, loadImages } from './render';
import { Game, type Enemy, type FrontSpec, type FrontState, type GameEvent, type Phase } from './sim';
import { dlog, setupDebug } from './debug';
import { WarRoom } from './warroom';
import { Ui, saveBest, type CoopInfo, type PairInfo } from './ui';

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
    (document.activeElement as HTMLElement | null)?.blur?.(); // close the on-screen keyboard if a text box still has it
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
    // linked with no front to fight: wander and harvest; otherwise the waves start
    if (isLinked() && !front) game.startRoam();
    else game.startWave();
    if (controls.touchMode) goFullscreen();
  };

  // The browser's own bars take a third of a phone held sideways. Chrome on Android can hide them with the Fullscreen
  // API (needs a tap); iPhone Safari cannot, so there the game has to be added to the home screen (see README).
  const installed = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  const fsBtn = document.getElementById('fsBtn') as HTMLButtonElement;
  const syncFsBtn = () => { fsBtn.hidden = !document.fullscreenEnabled || !!document.fullscreenElement || installed(); };
  function goFullscreen(): void {
    if (!document.fullscreenEnabled || document.fullscreenElement || installed()) return;
    document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => { /* refused without a tap, or not supported: the button stays */ });
  }
  fsBtn.addEventListener('click', goFullscreen);
  document.addEventListener('fullscreenchange', syncFsBtn);
  // the first touch on the page is the tap the browser wants before it will go fullscreen
  document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') goFullscreen(); }, { once: true, passive: true });
  syncFsBtn();

  const onEvent = (e: GameEvent) => {
    sfx.play(e);
    if (!game) return;
    if (e === 'waveStart') {
      dlog('wave', { n: game.wave, front: game.front?.spec.id, pool: game.front?.pool });
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
    pairHost: () => void pairHost(),
    pairJoinStart: () => { pair = { mode: 'join', offer: null, answer: null, busy: false, error: null }; ui.showPair(pair); },
    pairAccept: (text) => void pairAccept(text),
    pairJoin: (text) => void pairJoin(text),
    pairCancel: () => { link.leave(); resetRoute(); showCoop(); },
    coopPeer: (url) => { savePeer(url); showCoop(); },
    coopBack: () => {
      joinError = null;
      if (!game) ui.showSelect();
      else if (paused) ui.showPause();
      else ui.hide();
    },
  });

  // ---- co-op link: this game plays the hero. It works alone, and the link only adds things.
  const route = { make: relayTransport };
  const link = makeLink(route);
  // serverless pairing: one device runs the relay in its page, the other connects to it by WebRTC
  let hub: RtcHub | null = null;
  let invite: Invite | null = null;
  let pair: PairInfo | null = null;
  const resetRoute = () => {
    route.make = relayTransport;
    invite?.cancel();
    hub?.close();
    invite = hub = pair = null;
  };
  const showPair = (patch: Partial<PairInfo>) => { if (pair) { pair = { ...pair, ...patch }; ui.showPair(pair); } };
  const pairFail = (e: unknown) => showPair({ busy: false, error: e instanceof Error ? e.message : 'Could not pair' });
  const pairHost = async () => {
    pair = { mode: 'host', offer: null, answer: null, busy: false, error: null };
    ui.showPair(pair);
    try {
      const h = hub = new RtcHub();
      route.make = () => h.localTransport();
      invite = await h.invite(await link.host());
      showPair({ offer: invite.offer });
    } catch (e) { pairFail(e); }
  };
  const pairAccept = async (text: string) => {
    showPair({ busy: true, error: null });
    try { await invite?.accept(text); showPair({ busy: false }); } catch (e) { pairFail(e); }
  };
  const pairJoin = async (text: string) => {
    showPair({ busy: true, error: null });
    try {
      const r = await reply(text);
      let used = false;
      route.make = () => (used ? deadTransport() : ((used = true), r.transport));
      showPair({ busy: false, answer: r.answer });
      link.join(r.code).catch(() => { pairFail(new Error(link.error ?? 'The host did not accept the reply in time')); resetRoute(); });
    } catch (e) { pairFail(e); }
  };
  const warroom = new WarRoom();
  setupDebug(() => {
    const f = game?.front;
    return f ? `front ${f.spec.id} wave ${game!.wave} pool ${f.pool}/${f.spec.pool}
pressure ${game!.pressure.toFixed(2)} bounty ${f.bounty} bosses ${f.bosses}
enemies ${game!.enemiesLeft} hp ${Math.round(game!.player.hp)}/${game!.stats.maxHp}` : `link ${link.state}${game ? ' · wave ' + game.wave : ''}`;
  });
  let busy = false;
  let joinError: string | null = null;
  const coopInfo = (): CoopInfo => {
    const peer = defaultPeer();
    const url = link.state === 'hosting' && link.code ? joinUrl(peer, link.code) : null;
    return {
    qr: url ? qrSvg(url) : null,
    peer,
    localhost: ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname),
    state: link.state,
    code: link.code,
    peers: link.peers.map((p) => ({ role: p.role, name: p.name, online: p.online })),
    error: joinError ?? link.error,
    busy,
    };
  };
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
    dlog('link', link.state);
    if (link.state === 'solo') { warroom.clear(); if (!pair?.busy) resetRoute(); }
    if (link.state === 'linked' && pair) { pair = null; showCoop(); }
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
    if (link.state === 'linked') link.send('front.result', { id: f.spec.id, outcome: f.result, kills: game.kills, loot: game.loot });
    dlog('front.result', { id: f.spec.id, outcome: f.result, kills: game.kills, wave: game.wave, loot: game.loot });
    if (f.result === 'lost') return;
    ui.banner(f.result === 'won' ? 'FRONT HELD' : 'RECALLED', f.result === 'won');
    // back to wandering, ready for the next front
    setTimeout(() => {
      if (game?.front !== f) return;
      if (isLinked()) start(charId);
      else { game = null; ui.showHud(false); ui.showSelect(); }
    }, 2500);
  };
  const syncLinked = () => {
    document.body.classList.toggle('linked', isLinked());
    if (game) game.linked = isLinked();
    if (game?.roaming && !isLinked()) game.endRoam(); // the commander left: ordinary waves again
    if (link.state === 'linked' && game && !game.front && !game.roaming) game.startRoam(); // a commander joined a game in progress
    if (link.state === 'solo') for (const k of Object.keys(molds)) delete molds[k];
    if (link.state === 'linked' && game) { molds[game.ch.id] = { ...game.levels }; report(); }
  };
  link.onMessage((e) => { if (handleEnvelope(e, { game, molds, openFront: (spec) => { dlog('front.open', spec); start(charId || CHARACTERS[0].id, spec); },
    overview: (o) => warroom.update(o), send: (t, b) => link.send(t, b) })) report(); });
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
  window.visualViewport?.addEventListener('resize', () => renderer.syncSize());
  window.addEventListener('orientationchange', () => setTimeout(() => renderer.syncSize(), 200));
  document.addEventListener('fullscreenchange', () => renderer.syncSize());

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
    renderer.syncSize();
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
