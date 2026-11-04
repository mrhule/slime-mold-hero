import type { Input } from './sim';

/** radius of a virtual stick in CSS pixels */
export const STICK_R = 60;

export interface Stick { id: number; ox: number; oy: number; x: number; y: number }

/** a thumb that rests or jitters inside this many pixels of where it landed counts as centred */
export const DEAD_ZONE = 8;

/** the stick's direction and strength (0 to 1), with a dead zone and a smooth start so a resting thumb does not creep */
export function vec(s: Stick): { x: number; y: number; mag: number } {
  const dx = s.x - s.ox;
  const dy = s.y - s.oy;
  const m = Math.hypot(dx, dy);
  if (m <= DEAD_ZONE) return { x: 0, y: 0, mag: 0 };
  const k = Math.min(1, (m - DEAD_ZONE) / (STICK_R - DEAD_ZONE));
  return { x: (dx / m) * k, y: (dy / m) * k, mag: k };
}

/**
 * Move the thumb. Past the edge of the stick the stick's centre follows the thumb, so reversing direction takes a
 * short move instead of dragging all the way back across a stick the thumb had already left.
 */
export function dragStick(s: Stick, x: number, y: number): void {
  s.x = x;
  s.y = y;
  const dx = x - s.ox;
  const dy = y - s.oy;
  const d = Math.hypot(dx, dy);
  if (d > STICK_R) {
    s.ox += (dx / d) * (d - STICK_R);
    s.oy += (dy / d) * (d - STICK_R);
  }
}

/** firing starts at a firm push and stops only when the thumb is nearly back at the centre, so it does not flicker at the edge */
export const FIRE_ON = 0.3;
export const FIRE_OFF = 0.12;

/**
 * Touch (primary): left thumb moves, right thumb aims and fires while dragged, a button casts.
 * Desktop: WASD / arrows to move, left mouse to shoot, right mouse for magic.
 */
export class Controls {
  touchMode = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  mouse = { x: 0, y: 0 };
  private keys = new Set<string>();
  private buttons = new Set<number>();
  private move: Stick | null = null;
  private aim: Stick | null = null;
  private castHeld = false;
  private lastAim: number | null = null;
  private firing = false;

  constructor(canvas: HTMLCanvasElement, private onKey: (code: string) => void, private onMode: (touch: boolean) => void) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.onKey(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.release());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        this.setMode(true);
        const s: Stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
        if (e.clientX < window.innerWidth / 2) { if (!this.move) this.move = s; } else if (!this.aim) this.aim = s;
        try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        e.preventDefault();
      } else {
        this.buttons.add(e.button);
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        for (const s of [this.move, this.aim]) if (s && s.id === e.pointerId) dragStick(s, e.clientX, e.clientY);
      }
    });
    const up = (e: PointerEvent) => {
      if (this.move?.id === e.pointerId) this.move = null;
      if (this.aim?.id === e.pointerId) this.aim = null;
      if (e.pointerType !== 'touch') this.buttons.delete(e.button);
    };
    // a thumb can lift or be taken by the system anywhere, not only over the canvas, and a stick left behind would hold the hero
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      canvas.addEventListener(t, up);
      window.addEventListener(t, (e) => { if (e.pointerType === 'touch') up(e); });
    }
    // two fingers on a phone are also the gestures for zooming and scrolling the page; keep them for the game
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    // (menus and text boxes keep their own scrolling)
    document.addEventListener('touchmove', (e) => { if (this.touchMode && !(e.target as HTMLElement | null)?.closest?.('#overlay, #debugPanel, #warroom')) e.preventDefault(); }, { passive: false });
    window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch') this.buttons.delete(e.button); });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
        this.setMode(false);
      }
    });

    // the spell button is a DOM element so it can sit over the HUD
    const btn = document.getElementById('spellIcon');
    if (btn) {
      btn.addEventListener('pointerdown', (e) => { this.castHeld = true; this.setMode(e.pointerType === 'touch' || this.touchMode); e.preventDefault(); });
      for (const t of ['pointerup', 'pointercancel', 'pointerleave'] as const) btn.addEventListener(t, () => (this.castHeld = false));
    }
    this.onMode(this.touchMode);
  }

  private setMode(touch: boolean): void {
    if (touch === this.touchMode) return;
    this.touchMode = touch;
    this.onMode(touch);
  }

  release(): void {
    this.keys.clear();
    this.buttons.clear();
    this.move = null;
    this.aim = null;
    this.castHeld = false;
    this.firing = false;
  }

  /** sticks to draw on screen */
  sticks(): Stick[] {
    return [this.move, this.aim].filter((s): s is Stick => !!s);
  }

  /** `fallbackAim` is the angle to the nearest enemy, used until the player has aimed with the right stick */
  read(toWorld: (x: number, y: number) => { x: number; y: number }, p: { x: number; y: number }, fallbackAim: number | null): Input {
    if (this.touchMode) {
      const mv = this.move ? vec(this.move) : { x: 0, y: 0 };
      const av = this.aim ? vec(this.aim) : null;
      if (av && av.mag > 0.05) this.lastAim = Math.atan2(av.y, av.x);
      this.firing = !!av && av.mag > (this.firing ? FIRE_OFF : FIRE_ON);
      const ang = this.lastAim ?? fallbackAim ?? 0;
      return {
        moveX: mv.x, moveY: mv.y,
        aimX: p.x + Math.cos(ang) * 300, aimY: p.y + Math.sin(ang) * 300,
        fire: this.firing, cast: this.castHeld,
      };
    }
    const k = this.keys;
    const aim = toWorld(this.mouse.x, this.mouse.y);
    return {
      moveX: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      moveY: (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0),
      aimX: aim.x,
      aimY: aim.y,
      fire: this.buttons.has(0),
      cast: this.buttons.has(2) || this.castHeld,
    };
  }
}
