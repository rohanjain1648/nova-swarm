import { TAU } from "../core/math";
import type { Particle, FloatText } from "./types";

/**
 * Pooled particle + floating-text system. Slots are reused (dead flag +
 * free-list scan) so a long run never grows the arrays unbounded, and the hot
 * emit path allocates nothing after warm-up.
 */
export class Particles {
  readonly items: Particle[] = [];
  readonly texts: FloatText[] = [];
  // Matches the InstancerPool capacity in render/fx.ts — each particle is a
  // real instanced mesh in the 3D build, so the cap is much lower than a
  // 2D build's cheap pixel-rect particles would need.
  private readonly maxParticles = 340;

  private acquire(): Particle {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].dead) return this.items[i];
    }
    if (this.items.length >= this.maxParticles) {
      // Recycle the oldest rather than exceed the cap.
      return this.items[0];
    }
    const p: Particle = {
      x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1,
      size: 2, color: "#fff", dead: true, drag: 0,
    };
    this.items.push(p);
    return p;
  }

  spark(x: number, y: number, color: string, count: number, speed: number, size = 2.5): void {
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      const a = Math.random() * TAU;
      const s = speed * (0.4 + Math.random() * 0.6);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.maxLife = p.life = 0.3 + Math.random() * 0.4;
      p.size = size * (0.6 + Math.random() * 0.8);
      p.color = color;
      p.drag = 3.2;
      p.dead = false;
    }
  }

  text(x: number, y: number, str: string, color: string, size = 18): void {
    let t: FloatText | undefined;
    for (let i = 0; i < this.texts.length; i++) {
      if (this.texts[i].dead) { t = this.texts[i]; break; }
    }
    if (!t) {
      t = { x: 0, y: 0, vy: 0, life: 0, maxLife: 1, text: "", color: "#fff", size: 16, dead: true };
      this.texts.push(t);
    }
    t.x = x + (Math.random() - 0.5) * 14;
    t.y = y;
    t.vy = -46;
    t.maxLife = t.life = 0.75;
    t.text = str;
    t.color = color;
    t.size = size;
    t.dead = false;
  }

  update(dt: number): void {
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (p.dead) continue;
      p.life -= dt;
      if (p.life <= 0) { p.dead = true; continue; }
      const d = 1 - p.drag * dt;
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = 0; i < this.texts.length; i++) {
      const t = this.texts[i];
      if (t.dead) continue;
      t.life -= dt;
      if (t.life <= 0) { t.dead = true; continue; }
      t.y += t.vy * dt;
      t.vy *= 1 - 2 * dt;
    }
  }

  reset(): void {
    for (const p of this.items) p.dead = true;
    for (const t of this.texts) t.dead = true;
  }
}
