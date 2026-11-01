import type { Input } from './sim';

/** radius of a virtual stick in CSS pixels */
export const STICK_R = 60;

export interface Stick { id: number; ox: number; oy: number; x: number; y: number }

function vec(s: Stick): { x: number; y: number; mag: number } {
  const dx = s.x - s.ox;
  const dy = s.y - s.oy;
  const m = Math.hypot(dx, dy);
  if (m < 1) return { x: 0, y: 0, mag: 0 };
  const k = Math.min(1, m / STICK_R);
  return { x: (dx / m) * k, y: (dy / m) * k, mag: k };
}

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

  constructor(canvas: HTMLCanvasElement, private onKey: (code: string) => void, private onMode: (touch: boolean) => void) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
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
        for (const s of [this.move, this.aim]) if (s && s.id === e.pointerId) { s.x = e.clientX; s.y = e.clientY; }
      }
    });
    const up = (e: PointerEvent) => {
      if (this.move?.id === e.pointerId) this.move = null;
      if (this.aim?.id === e.pointerId) this.aim = null;
      if (e.pointerType !== 'touch') this.buttons.delete(e.button);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
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
      if (av && av.mag > 0.2) this.lastAim = Math.atan2(av.y, av.x);
      const ang = this.lastAim ?? fallbackAim ?? 0;
      return {
        moveX: mv.x, moveY: mv.y,
        aimX: p.x + Math.cos(ang) * 300, aimY: p.y + Math.sin(ang) * 300,
        fire: !!av && av.mag > 0.25, cast: this.castHeld,
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
