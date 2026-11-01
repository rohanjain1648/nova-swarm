/**
 * Small, allocation-conscious math helpers used across the engine.
 * Vectors are plain { x, y } objects; helpers mutate or return numbers to
 * avoid churning the GC in the hot loop.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent smoothing factor for lerp toward a target. */
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

export const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.sqrt(dist2(ax, ay, bx, by));

export const len = (x: number, y: number): number => Math.sqrt(x * x + y * y);

export const angleTo = (fromX: number, fromY: number, toX: number, toY: number): number =>
  Math.atan2(toY - fromY, toX - fromX);

/** Shortest signed angular difference b - a, wrapped to [-PI, PI]. */
export const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % TAU;
  if (d < -Math.PI) d += TAU;
  else if (d > Math.PI) d -= TAU;
  return d;
};

/**
 * Mulberry32 — a tiny, fast, deterministic PRNG. Seeded so runs are
 * reproducible for debugging and so the daily challenge could be added later.
 */
export class RNG {
  private state: number;

  constructor(seed = (Math.random() * 2 ** 32) >>> 0) {
    this.state = seed >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Random unit-ish direction as [cos, sin]. */
  angle(): number {
    return this.next() * TAU;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}
