import { expect, test } from "vitest";
import {
  applySnapshot,
  captureSnapshot,
  decodeSnapshot,
  encodeSnapshot,
  type EnemySnap,
  type PlayerSnap,
  type Snapshot,
} from "../../src/net/snapshot";
import { IDLE_INPUT, type PlayerInput } from "../../src/game/types";
import { World } from "../../src/game/world";
import { aimAtNearest, silentAudio } from "./helpers";

const player = (slot: number, over: Partial<PlayerSnap> = {}): PlayerSnap => ({
  slot, active: true, x: 10 * slot, y: -5, vx: 1, vy: 2, facing: 0.5, hp: 80, maxHp: 100, downed: false,
  reviveT: 0, invuln: 0, orbital: 0, orbitAngle: 0, pickupRadius: 130, kills: 3,
  speed: 210, blaster: 1, nova: 0, pingCd: 0, recoilT: 0, ...over,
});
const enemy = (i: number, over: Partial<EnemySnap> = {}): EnemySnap => ({
  i, kind: "grunt", x: 0, y: 0, flash: 0, spawnT: 1, punchT: 0, ...over,
});
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  seq: 1, time: 12.5, level: 3, xp: 4.25, xpToNext: 30, kills: 0, bossHp: -1, waitingMask: 0, gameOver: false,
  players: [], enemies: [], bullets: [], enemyBullets: [], gems: [], novaRings: [], pings: [], effects: [],
  ...over,
});

/** Deep equality with float tolerance (Float32 on the wire). */
function expectClose(actual: unknown, expected: unknown, path = "$"): void {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    expect(Math.abs((actual as number) - expected), path).toBeLessThan(1e-3);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, path).toBe(expected.length);
    expected.forEach((v, k) => expectClose((actual as unknown[])[k], v, `${path}[${k}]`));
  } else if (expected && typeof expected === "object") {
    for (const key of Object.keys(expected)) {
      expectClose((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], `${path}.${key}`);
    }
  } else {
    expect(actual, path).toEqual(expected);
  }
}

test("encode -> decode round-trips", () => {
  const s = snap({
    seq: 77,
    bossHp: 0.42,
    waitingMask: 0b0101,
    players: [player(0), player(1, { downed: true, reviveT: 0.6, orbital: 2, orbitAngle: 1.25 })],
    enemies: [enemy(0, { x: 1234.5, y: -987.25 }), enemy(4, { kind: "shooter", flash: 0.5 }), enemy(9, { kind: "boss" })],
    bullets: [{ i: 0, x: 1, y: 2, r: 5 }, { i: 3, x: -1, y: -2, r: 5 }],
    enemyBullets: [{ i: 1, x: 7, y: 8, r: 7 }],
    gems: [{ i: 2, x: 3, y: 4, r: 7, heal: false }, { i: 5, x: 30, y: 40, r: 10, heal: true }],
    novaRings: [{ x: 5, y: 6, r: 120 }],
    pings: [{ slot: 1, x: 100, y: 200, life: 3.5 }],
    effects: [
      { k: "sfx", n: "kill", slot: -1 },
      { k: "text", x: 1, y: 2, text: "42", color: "#fff2a8", size: 20 },
    ],
  });
  expectClose(decodeSnapshot(encodeSnapshot(s)), s);
});

test("a 70-enemy snapshot encodes under 4 KB", () => {
  const enemies = Array.from({ length: 70 }, (_, i) => enemy(i, { x: i * 10, y: i * -7 }));
  const bytes = encodeSnapshot(snap({ players: [player(0), player(1)], enemies }));
  expect(bytes.byteLength).toBeLessThan(4096);
});

test("applySnapshot interpolates enemy positions", () => {
  const w = new World(silentAudio());
  const a = snap({ enemies: [enemy(2, { x: 0 })] });
  const b = snap({ enemies: [enemy(2, { x: 100 })] });
  applySnapshot(w, a, b, 0.25, 0);
  expect(w.enemies[2].dead).toBe(false);
  expect(w.enemies[2].x).toBeCloseTo(25);
});

test("applySnapshot marks absent enemy slots dead", () => {
  const w = new World(silentAudio());
  applySnapshot(w, snap(), snap({ enemies: [enemy(0), enemy(1)] }), 1, 0);
  expect(w.enemies.filter((e) => !e.dead)).toHaveLength(2);
  applySnapshot(w, snap(), snap({ enemies: [enemy(1)] }), 1, 0);
  expect(w.enemies[0].dead).toBe(true);
  expect(w.enemies[1].dead).toBe(false);
});

test("applySnapshot leaves the local player's position alone but updates its hp/downed", () => {
  const w = new World(silentAudio());
  w.reset([{ slot: 0, name: "A" }, { slot: 1, name: "B" }]);
  w.localSlot = 1;
  w.players[1].x = 55;
  const b = snap({ players: [player(0, { x: 300 }), player(1, { x: 999, hp: 12, downed: true })] });
  applySnapshot(w, b, b, 1, 1);
  expect(w.players[1].x).toBe(55);
  expect(w.players[1].hp).toBe(12);
  expect(w.players[1].downed).toBe(true);
  expect(w.players[0].x).toBeCloseTo(300);
});

test("captureSnapshot from a live 2-player World round-trips through encode/decode", () => {
  const w = new World(silentAudio());
  w.reset([{ slot: 0, name: "A" }, { slot: 1, name: "B" }]);
  const inp: PlayerInput = { ...IDLE_INPUT, firing: true, aimActive: true };
  for (let i = 0; i < 20 * 60 && !w.gameOver; i++) {
    aimAtNearest(w, w.players[0], inp);
    w.update(1 / 60, [inp, IDLE_INPUT]);
  }
  const s = captureSnapshot(w, 5, 0b10, [{ k: "trauma", v: 0.5, slot: 1 }]);
  expect(s.enemies.length).toBeGreaterThan(0);
  expect(s.players).toHaveLength(2);
  expectClose(decodeSnapshot(encodeSnapshot(s)), s);
});

test("applySnapshot syncs the local player's own stats and the team kill count", () => {
  const w = new World(silentAudio());
  w.reset([{ slot: 0, name: "A" }, { slot: 1, name: "B" }]);
  w.localSlot = 1;
  const b = snap({ kills: 17, players: [player(0), player(1, { speed: 231, blaster: 3, nova: 2, pingCd: 1.5 })] });
  applySnapshot(w, b, b, 1, 1);
  expect(w.players[1].speed).toBeCloseTo(231);
  expect(w.players[1].blaster).toBe(3);
  expect(w.players[1].nova).toBe(2);
  expect(w.players[1].pingCd).toBeCloseTo(1.5);
  expect(w.kills).toBe(17);
  expectClose(decodeSnapshot(encodeSnapshot(b)), b);
});

test("a reused enemy slot (new spawn) is not interpolated from the dead one", () => {
  const w = new World(silentAudio());
  const a = snap({ enemies: [enemy(3, { x: 0, spawnT: 5 })] });
  const b = snap({ enemies: [enemy(3, { x: 900, spawnT: 0.02 })] });
  applySnapshot(w, a, b, 0.25, 0);
  expect(w.enemies[3].x).toBe(900);
});

test("a reused bullet/gem slot that jumped far is not interpolated", () => {
  const w = new World(silentAudio());
  const a = snap({ bullets: [{ i: 0, x: 0, y: 0, r: 5 }], gems: [{ i: 1, x: 0, y: 0, r: 7, heal: false }] });
  const b = snap({ bullets: [{ i: 0, x: 800, y: 0, r: 5 }], gems: [{ i: 1, x: 0, y: 600, r: 7, heal: false }] });
  applySnapshot(w, a, b, 0.5, 0);
  expect(w.bullets[0].x).toBe(800);
  expect(w.gems[1].y).toBe(600);
  // A normal in-flight bullet still interpolates.
  const c = snap({ bullets: [{ i: 0, x: 832, y: 0, r: 5 }] });
  applySnapshot(w, b, c, 0.5, 0);
  expect(w.bullets[0].x).toBeCloseTo(816);
});

test("recoil and punch survive the wire and reach the view world", () => {
  const w = new World(silentAudio());
  w.reset([{ slot: 0, name: "A" }, { slot: 1, name: "B" }]);
  const b = snap({ players: [player(0, { recoilT: 0.75 }), player(1)], enemies: [enemy(0, { punchT: 0.25 })] });
  const d = decodeSnapshot(encodeSnapshot(b));
  applySnapshot(w, d, d, 1, 1);
  expect(w.players[0].recoilT).toBeCloseTo(0.75);
  expect(w.enemies[0].punchT).toBeCloseTo(0.25);
});
