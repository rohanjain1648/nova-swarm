import { beforeEach, expect, test } from "vitest";
import { ENEMIES, PLAYER } from "../../src/game/config";
import { hpScale } from "../../src/game/enemies";
import type { EnemyKind } from "../../src/game/config";
import { IDLE_INPUT, type PlayerInput } from "../../src/game/types";
import { World } from "../../src/game/world";
import { aimAtNearest, runFor, silentAudio } from "./helpers";

const DT = 1 / 60;
const IDLE2 = [IDLE_INPUT, IDLE_INPUT];
let w: World;

/** Reach into World's private spawner — tests need an enemy at an exact spot. */
const spawn = (kind: EnemyKind, x: number, y: number) =>
  (w as unknown as { spawnEnemyAt: (k: EnemyKind, x: number, y: number) => void }).spawnEnemyAt(kind, x, y);
const dropGem = (x: number, y: number, value: number) =>
  (w as unknown as { dropGem: (x: number, y: number, v: number, k: "xp") => void }).dropGem(x, y, value, "xp");
const at = (slot: number, x: number, y: number) => {
  w.players[slot].x = x;
  w.players[slot].y = y;
};
/** Knock a player down the way the sim does: hp to 0, then one step. */
const down = (slot: number) => {
  w.players[slot].hp = 0;
  w.update(DT, IDLE2);
};
/** Stop the director from spawning anything into the test's arena. */
const quietDirector = () => {
  (w as unknown as { director: { update: () => void } }).director.update = () => {};
};

beforeEach(() => {
  w = new World(silentAudio());
  w.reset([{ slot: 0, name: "A" }, { slot: 1, name: "B" }]);
});

test("enemies chase the nearest living player", () => {
  quietDirector();
  at(0, 0, 0);
  at(1, 500, 0);
  down(0);
  expect(w.players[0].downed).toBe(true);
  at(1, 500, 0);
  spawn("grunt", 300, 0);
  const e = w.enemies.find((x) => !x.dead)!;
  runFor(w, 1, IDLE2);
  expect(e.x).toBeGreaterThan(300);
});

test("downed player is revived by a teammate standing close for 3 s", () => {
  quietDirector();
  at(0, 0, 0);
  at(1, 40, 0);
  down(0);
  runFor(w, 3.1, IDLE2);
  const p = w.players[0];
  expect(p.downed).toBe(false);
  expect(Math.abs(p.hp - Math.round(p.maxHp * 0.3))).toBeLessThanOrEqual(1);
});

test("revive progress resets when the teammate walks away", () => {
  quietDirector();
  at(0, 0, 0);
  at(1, 40, 0);
  down(0);
  runFor(w, 1.5, IDLE2);
  expect(w.players[0].reviveT).toBeGreaterThan(0.3);
  at(1, 500, 0);
  runFor(w, 0.1, IDLE2);
  expect(w.players[0].reviveT).toBe(0);
});

test("run ends only when all active players are downed", () => {
  quietDirector();
  at(0, 0, 0);
  at(1, 900, 0);
  down(0);
  expect(w.gameOver).toBe(false);
  down(1);
  expect(w.gameOver).toBe(true);
});

test("removing the last living player ends the run", () => {
  quietDirector();
  at(0, 0, 0);
  at(1, 900, 0);
  down(0);
  w.removePlayer(1);
  w.update(DT, IDLE2);
  expect(w.gameOver).toBe(true);
});

test("XP from any player's pickup goes to the team pool", () => {
  quietDirector();
  at(0, -1200, 0);
  at(1, 800, 0);
  dropGem(800, 0, 2);
  runFor(w, 0.2, IDLE2);
  expect(w.xp).toBeGreaterThan(0);
});

test("kills are credited to the shooter", () => {
  at(0, -1400, -1400);
  at(1, 0, 0);
  const shooter: PlayerInput = { ...IDLE_INPUT, firing: true, aimActive: true };
  for (let i = 0; i < 30 * 60 && !w.gameOver; i++) {
    aimAtNearest(w, w.players[1], shooter);
    w.update(DT, [IDLE_INPUT, shooter]);
  }
  expect(w.players[1].kills).toBeGreaterThan(0);
  expect(w.players[0].kills).toBe(0);
});

test("difficulty scales with active count", () => {
  quietDirector();
  runFor(w, 1, IDLE2);
  spawn("grunt", 400, 400);
  const e = w.enemies.find((x) => !x.dead)!;
  expect(e.maxHp).toBe(Math.round(ENEMIES.grunt.baseHp * hpScale(w.time) * 1.3));
});

test("setRemotePose clamps teleports", () => {
  const p = w.players[1];
  p.remote = true;
  at(1, 0, 0);
  w.setRemotePose(1, 5000, 0, 0, false);
  expect(p.x).toBeLessThanOrEqual(PLAYER.baseSpeed * 0.25 + 1e-6);
  expect(p.x).toBeGreaterThan(0);
});

test("addPing respects cooldown", () => {
  quietDirector();
  expect(w.addPing(0)).toBe(true);
  expect(w.pings).toHaveLength(1);
  expect(w.addPing(0)).toBe(false);
  runFor(w, 2.01, IDLE2);
  expect(w.addPing(0)).toBe(true);
});

test("solo reset keeps one player and multipliers at 1", () => {
  w.reset();
  expect(w.players).toHaveLength(1);
  expect(w.activeCount).toBe(1);
  quietDirector();
  spawn("grunt", 400, 400);
  const e = w.enemies.find((x) => !x.dead)!;
  expect(e.maxHp).toBe(Math.round(ENEMIES.grunt.baseHp * hpScale(w.time)));
});

test("reset clears a co-op boss bar so it can't leak into solo", () => {
  w.bossHpOverride = 0.6;
  w.reset();
  expect(w.bossHpFraction).toBeNull();
});

test("a slot's class stats are applied at reset; a classless slot stays plain", () => {
  w.reset([{ slot: 0, name: "A" }, { slot: 1, name: "B", archetype: "vanguard" }]);
  expect(w.players[0].maxHp).toBe(PLAYER.baseHp);
  expect(w.players[1].maxHp).toBe(Math.round(PLAYER.baseHp * 1.5));
  expect(w.players[1].hp).toBe(w.players[1].maxHp);
  expect(w.players[1].armor).toBe(4);
});

test("an unknown class from the network is ignored", () => {
  w.reset([{ slot: 0, name: "A", archetype: "wizard" as never }]);
  expect(w.players[0].maxHp).toBe(PLAYER.baseHp);
});

test("firing kicks the shooter's recoil and a contact hit sets the enemy's punch", () => {
  quietDirector();
  at(0, 0, 0);
  at(1, 900, 0);
  w.update(DT, [{ ...IDLE_INPUT, firing: true, aimActive: true }, IDLE_INPUT]);
  expect(w.players[0].recoilT).toBeGreaterThan(0.9);
  spawn("grunt", 900, 0);
  runFor(w, 0.1, IDLE2);
  expect(w.enemies.find((e) => !e.dead)!.punchT).toBeGreaterThan(0);
});

test("haptics fire only for this player's own hurt and for shared level-ups", () => {
  const got: string[] = [];
  w.onHaptic = (k) => got.push(k);
  w.applyEffect({ k: "sfx", n: "hurt", slot: 1 });
  expect(got).toEqual([]);
  w.applyEffect({ k: "sfx", n: "hurt", slot: 0 });
  w.applyEffect({ k: "sfx", n: "levelup", slot: -1 });
  w.applyEffect({ k: "sfx", n: "bigKill", slot: -1 });
  w.applyEffect({ k: "sfx", n: "bigKill", slot: 0 });
  expect(got).toEqual(["hit", "levelup", "gameover"]);
});
