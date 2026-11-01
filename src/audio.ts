import type { GameEvent } from './sim';

/** Tiny synthesized sound effects (no audio files). Browsers only allow sound after a first click or key press. */
export class Sfx {
  private ctx?: AudioContext;
  muted = false;
  private last: Partial<Record<GameEvent, number>> = {};

  unlock(): void {
    try {
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
    } catch {
      /* no audio available */
    }
  }

  play(e: GameEvent): void {
    const c = this.ctx;
    if (!c || this.muted || c.state !== 'running') return;
    const gap: Partial<Record<GameEvent, number>> = { shoot: 0.045, hit: 0.04, kill: 0.05, pickup: 0.05, hurt: 0.15 };
    const now = c.currentTime;
    if (now - (this.last[e] ?? -1) < (gap[e] ?? 0)) return;
    this.last[e] = now;
    switch (e) {
      case 'shoot': this.tone(520, 0.07, 'square', 0.04, -250); break;
      case 'enemyShoot': this.tone(300, 0.12, 'sawtooth', 0.04, 150); break;
      case 'hit': this.tone(180, 0.05, 'triangle', 0.06, -60); break;
      case 'kill': this.noise(0.12, 0.09, 900); this.tone(140, 0.12, 'sine', 0.08, -80); break;
      case 'hurt': this.noise(0.2, 0.14, 500); this.tone(110, 0.2, 'sawtooth', 0.08, -60); break;
      case 'cast': this.tone(220, 0.35, 'sine', 0.12, 500); this.noise(0.25, 0.06, 1800); break;
      case 'pickup': this.tone(880 + Math.random() * 200, 0.07, 'sine', 0.05, 300); break;
      case 'buy': this.tone(660, 0.08, 'square', 0.06, 0); setTimeout(() => this.tone(990, 0.12, 'square', 0.06, 0), 70); break;
      case 'waveStart': this.tone(196, 0.3, 'sawtooth', 0.08, 120); break;
      case 'waveClear': [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'triangle', 0.09, 0), i * 110)); break;
      case 'boss': this.tone(70, 0.8, 'sawtooth', 0.14, -20); break;
      case 'dead': this.tone(200, 0.9, 'sawtooth', 0.12, -170); this.noise(0.6, 0.1, 400); break;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide: number): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur);
  }

  private noise(dur: number, vol: number, cutoff: number): void {
    const c = this.ctx!;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    s.connect(f).connect(g).connect(c.destination);
    s.start();
  }
}
