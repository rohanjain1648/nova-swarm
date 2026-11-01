import type { Audio } from "../core/audio";
import type { Particles } from "./particles";

/**
 * Every cosmetic side-effect of the simulation — sound, sparks, floating
 * text, screen flash, camera shake — expressed as plain data. The host's
 * World applies these locally *and* records them for the network; a co-op
 * client replays the recorded list through the same `applyEffect`, so there is
 * exactly one place that turns gameplay into game feel.
 *
 * `slot` targets one player's screen (their shots, their hurt flash); -1 means
 * everyone.
 */
export type Sfx = "shoot" | "hit" | "kill" | "bigKill" | "hurt" | "pickup" | "levelup" | "bossWarn";

export type Effect =
  | { k: "sfx"; n: Sfx; slot: number }
  | { k: "spark"; x: number; y: number; color: string; count: number; speed: number; size: number }
  | { k: "text"; x: number; y: number; text: string; color: string; size: number }
  | { k: "flash"; color: string; i: number; slot: number }
  | { k: "trauma"; v: number; slot: number };

export interface EffectTarget {
  readonly particles: Particles;
  flash(color: string, intensity: number): void;
  addTrauma(v: number): void;
}

const forMe = (slot: number, localSlot: number): boolean => slot === -1 || slot === localSlot;

export function applyEffect(t: EffectTarget, audio: Audio, ev: Effect, localSlot: number): void {
  switch (ev.k) {
    case "sfx":
      if (forMe(ev.slot, localSlot)) audio[ev.n]();
      break;
    case "spark":
      t.particles.spark(ev.x, ev.y, ev.color, ev.count, ev.speed, ev.size);
      break;
    case "text":
      t.particles.text(ev.x, ev.y, ev.text, ev.color, ev.size);
      break;
    case "flash":
      if (forMe(ev.slot, localSlot)) t.flash(ev.color, ev.i);
      break;
    case "trauma":
      if (forMe(ev.slot, localSlot)) t.addTrauma(ev.v);
      break;
  }
}
