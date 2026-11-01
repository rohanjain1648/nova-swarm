import type { Audio } from "../../src/core/audio";
import type { PlayerInput } from "../../src/game/types";
import type { World } from "../../src/game/world";

/** An Audio stand-in whose every method is a no-op (World never needs real sound in tests). */
export function silentAudio(): Audio {
  return new Proxy({ muted: false } as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : () => {}),
  }) as unknown as Audio;
}

/** Advance a World by `seconds` of fixed 1/60 steps, stopping early on game over. */
export function runFor(world: World, seconds: number, inputs: readonly PlayerInput[]): void {
  const dt = 1 / 60;
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps && !world.gameOver; i++) world.update(dt, inputs);
}

/** Point `inp`'s aim at the nearest live enemy to (p.x, p.y) — a stand-in for a player tracking targets. */
export function aimAtNearest(world: World, p: { x: number; y: number }, inp: PlayerInput): void {
  let best = Infinity;
  for (const e of world.enemies) {
    if (e.dead) continue;
    const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d < best) {
      best = d;
      const l = Math.sqrt(d) || 1;
      inp.aimX = (e.x - p.x) / l;
      inp.aimY = (e.y - p.y) / l;
    }
  }
}
