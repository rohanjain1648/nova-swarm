import { expect, test } from "vitest";
import { applyEffect } from "../../src/game/effects";
import { IDLE_INPUT, type PlayerInput } from "../../src/game/types";
import { World } from "../../src/game/world";
import { aimAtNearest, silentAudio } from "./helpers";

test("emit records only when recordEffects is true", () => {
  const w = new World(silentAudio());
  const inp: PlayerInput = { ...IDLE_INPUT, firing: true, aimActive: true };
  const run = (s: number) => {
    for (let i = 0; i < s * 60 && !w.gameOver; i++) {
      aimAtNearest(w, w.player, inp);
      w.update(1 / 60, [inp]);
    }
  };
  run(2);
  expect(w.drainEffects()).toEqual([]);
  w.recordEffects = true;
  run(10);
  const fx = w.drainEffects();
  expect(fx).toContainEqual({ k: "sfx", n: "shoot", slot: 0 });
  expect(w.drainEffects()).toEqual([]);
});

test("applyEffect skips effects targeted at another slot", () => {
  const w = new World(silentAudio());
  applyEffect(w, silentAudio(), { k: "flash", color: "255,0,0", i: 1, slot: 1 }, 0);
  expect(w.flashT).toBe(0);
  applyEffect(w, silentAudio(), { k: "flash", color: "255,0,0", i: 1, slot: 0 }, 0);
  expect(w.flashT).toBe(1);
  applyEffect(w, silentAudio(), { k: "spark", x: 0, y: 0, color: "#fff", count: 3, speed: 100, size: 2 }, 0);
  expect(w.particles.items.filter((p) => !p.dead).length).toBe(3);
});
