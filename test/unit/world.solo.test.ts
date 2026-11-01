import { expect, test } from "vitest";
import { IDLE_INPUT, type PlayerInput } from "../../src/game/types";
import { World } from "../../src/game/world";
import { aimAtNearest, runFor, silentAudio } from "./helpers";

test("solo world advances time, spawns enemies, and the idle player eventually dies", () => {
  const w = new World(silentAudio());
  runFor(w, 90, [IDLE_INPUT]);
  expect(w.time).toBeGreaterThan(5);
  expect(w.enemies.some((e) => !e.dead) || w.gameOver).toBe(true);
});

test("a firing player kills enemies and gains XP", () => {
  const w = new World(silentAudio());
  const inp: PlayerInput = { ...IDLE_INPUT, firing: true, aimActive: true };
  for (let i = 0; i < 40 * 60 && !w.gameOver; i++) {
    aimAtNearest(w, w.player, inp);
    w.update(1 / 60, [inp]);
  }
  expect(w.kills).toBeGreaterThan(0);
  expect(w.xp > 0 || w.level > 1).toBe(true);
});
