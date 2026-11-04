import { describe, expect, it } from 'vitest';
import { AIM_OFF, AIM_ON, DEAD_ZONE, STICK_R, dragStick, isManualAim, vec, type Stick } from '../src/input';

const stick = (x: number, y: number): Stick => ({ id: 1, ox: x, oy: y, x, y });

describe('virtual stick', () => {
  it('ignores a thumb resting or jittering inside the dead zone, then ramps up smoothly', () => {
    const s = stick(100, 100);
    dragStick(s, 100 + DEAD_ZONE, 100);
    expect(vec(s).mag).toBe(0);
    dragStick(s, 100 + DEAD_ZONE + 1, 100);
    expect(vec(s).mag).toBeGreaterThan(0);
    expect(vec(s).mag).toBeLessThan(0.1);
    dragStick(s, 100 + STICK_R, 100);
    expect(vec(s).mag).toBeCloseTo(1);
    expect(vec(s).x).toBeCloseTo(1);
  });

  it('follows the thumb past the edge, so reversing is a short move', () => {
    const s = stick(100, 100);
    dragStick(s, 100 + STICK_R * 3, 100);
    expect(s.ox).toBeCloseTo(100 + STICK_R * 2);
    expect(vec(s).mag).toBeCloseTo(1);
    dragStick(s, s.x - STICK_R * 1.5, 100);
    expect(vec(s).x).toBeLessThan(0.1); // already heading back, not still pinned at full right
  });

  it('keeps the direction when the thumb moves diagonally', () => {
    const s = stick(0, 0);
    dragStick(s, 30, -30);
    const v = vec(s);
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeLessThan(0);
    expect(Math.abs(v.x)).toBeCloseTo(Math.abs(v.y));
  });
});

describe('aim thumb', () => {
  it('aims by hand only on a firm push, and falls back to auto-aim only when nearly centred', () => {
    expect(isManualAim(false, AIM_ON - 0.01)).toBe(false);
    expect(isManualAim(false, AIM_ON + 0.01)).toBe(true);
    // once aiming by hand, easing off a little keeps the aim; it only lets go near the centre
    expect(isManualAim(true, AIM_ON - 0.05)).toBe(true);
    expect(isManualAim(true, AIM_OFF - 0.01)).toBe(false);
  });
});
