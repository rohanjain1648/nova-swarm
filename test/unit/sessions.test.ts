import { beforeEach, expect, test } from "vitest";
import { IDLE_INPUT } from "../../src/game/types";
import { World } from "../../src/game/world";
import { ClientSession } from "../../src/net/clientSession";
import type { ClientToHost, HostToClient, Wire } from "../../src/net/gameProtocol";
import { HostSession } from "../../src/net/hostSession";
import type { ClientToRelay } from "../../src/net/relayProtocol";
import { decodeSnapshot } from "../../src/net/snapshot";
import { silentAudio } from "./helpers";

const DT = 1 / 60;
const SLOTS = [{ slot: 0, name: "HOST" }, { slot: 1, name: "GUEST" }];

class FakeWire implements Wire {
  text: ClientToRelay[] = [];
  bin: Uint8Array[] = [];
  /** Host frames go here too, so a test can loop them into a client. */
  onBinary: (b: Uint8Array) => void = () => {};
  send(m: ClientToRelay): void {
    this.text.push(m);
  }
  sendBinary(b: Uint8Array): void {
    this.bin.push(b);
    this.onBinary(b.slice());
  }
  /** Game messages sent (inside relay `send` envelopes), optionally only those addressed to `to`. */
  game(to?: number): HostToClient[] {
    return this.text
      .filter((m): m is Extract<ClientToRelay, { t: "send" }> => m.t === "send" && (to === undefined || m.to === to))
      .map((m) => m.data as HostToClient);
  }
}

let hw: World;
let wire: FakeWire;
let host: HostSession;
const quietDirector = (w: World) => {
  (w as unknown as { director: { update: () => void } }).director.update = () => {};
};
const steps = (n: number) => {
  for (let i = 0; i < n; i++) host.step(DT, IDLE_INPUT);
};

beforeEach(() => {
  hw = new World(silentAudio());
  wire = new FakeWire();
  host = new HostSession(hw, wire);
  host.start(SLOTS);
  quietDirector(hw);
});

test("host start resets the world for every slot and announces it", () => {
  expect(hw.players).toHaveLength(2);
  expect(hw.players[1].remote).toBe(true);
  expect(wire.game()).toContainEqual({ k: "start", slots: SLOTS });
});

test("host broadcasts ~20 snapshots per simulated second", () => {
  steps(60);
  expect(wire.bin.length).toBeGreaterThanOrEqual(19);
  expect(wire.bin.length).toBeLessThanOrEqual(21);
});

test("client pose moves the remote player on the host", () => {
  steps(1);
  const x0 = hw.players[1].x;
  host.onClientMessage(1, { k: "pose", x: x0 + 5, y: hw.players[1].y, facing: 1, firing: false });
  expect(hw.players[1].x).toBeCloseTo(x0 + 5);
  expect(hw.players[1].facing).toBe(1);
});

test("huddle pauses the sim and resumes after all active players pick", () => {
  hw.pendingLevelUps = 1;
  steps(1);
  expect(host.huddle).not.toBeNull();
  expect(host.huddle!.cards.length).toBeGreaterThan(0);
  const cards = wire.game(1).find((m) => m.k === "cards");
  expect(cards).toMatchObject({ k: "cards", round: 1 });
  const t = hw.time;
  steps(30);
  expect(hw.time).toBe(t);
  expect(decodeSnapshot(wire.bin[wire.bin.length - 1]).waitingMask).toBe(0b11);

  host.pickLocal(0);
  expect(host.huddle!.waiting).toEqual([1]);
  host.onClientMessage(1, { k: "pick", round: 1, index: 2 });
  expect(host.huddle).toBeNull();
  expect(hw.pendingLevelUps).toBe(0);
  steps(5);
  expect(hw.time).toBeGreaterThan(t);
});

test("huddle auto-picks after 15 s", () => {
  hw.pendingLevelUps = 1;
  steps(1);
  steps(15 * 60 + 2);
  expect(host.huddle).toBeNull();
  expect(hw.pendingLevelUps).toBe(0);
  const taken = (s: number) => Object.values(hw.players[s].taken).reduce((a, b) => a + b, 0);
  expect(taken(0)).toBe(1);
  expect(taken(1)).toBe(1);
});

test("huddle completes when a waiting player is removed mid-huddle", () => {
  hw.pendingLevelUps = 1;
  steps(1);
  host.pickLocal(1);
  expect(host.huddle).not.toBeNull();
  host.onRoster([{ slot: 0, name: "HOST", connected: true }]);
  expect(host.huddle).toBeNull();
  expect(hw.players[1].active).toBe(false);
});

test("a disconnected (not yet removed) player stops firing", () => {
  hw.players[1].remoteFiring = true;
  host.onRoster([{ slot: 0, name: "HOST", connected: true }, { slot: 1, name: "GUEST", connected: false }]);
  expect(hw.players[1].remoteFiring).toBe(false);
  expect(hw.players[1].active).toBe(true);
});

test("two pending level-ups produce two rounds; a stale round-1 pick during round 2 is ignored", () => {
  hw.pendingLevelUps = 2;
  steps(1);
  host.pickLocal(0);
  host.onClientMessage(1, { k: "pick", round: 1, index: 0 });
  expect(host.huddle).toBeNull();
  expect(hw.pendingLevelUps).toBe(1);
  steps(1);
  expect(host.huddle!.round).toBe(2);
  expect(wire.game(1).filter((m) => m.k === "cards").map((m) => (m as { round: number }).round)).toEqual([1, 2]);
  host.onClientMessage(1, { k: "pick", round: 1, index: 0 });
  expect(host.huddle!.waiting).toContain(1);
  host.onClientMessage(1, { k: "pick", round: 2, index: 0 });
  host.pickLocal(0);
  expect(host.huddle).toBeNull();
  expect(hw.pendingLevelUps).toBe(0);
});

test('host sends "over" exactly once when all players are downed', () => {
  steps(1);
  for (const p of hw.players) p.hp = 0;
  steps(10);
  const overs = wire.game().filter((m) => m.k === "over");
  expect(overs).toHaveLength(1);
  expect(overs[0]).toMatchObject({ k: "over", perPlayer: [{ slot: 0, name: "HOST" }, { slot: 1, name: "GUEST" }] });
  expect(host.overInfo).not.toBeNull();
});

// ---- Client ----------------------------------------------------------------

let now: number;
let cw: World;
let cwire: FakeWire;
let client: ClientSession;
const startClient = () => {
  now = 0;
  cw = new World(silentAudio());
  cwire = new FakeWire();
  client = new ClientSession(cw, cwire, 1, () => now);
  client.onHostMessage({ k: "start", slots: SLOTS });
  wire.text.length = 0; // the host's "start" was just delivered by hand above
  wire.onBinary = (b) => client.onSnapshot(b.buffer as ArrayBuffer);
};
/** One fixed tick on both sides plus a client render frame. */
const tick = () => {
  host.step(DT, IDLE_INPUT);
  now += 1000 / 60;
  client.step(DT, IDLE_INPUT);
  client.frame(DT);
};

test("client applies snapshots and replays effects once each", () => {
  startClient();
  hw.recordEffects = true;
  let replayed = 0;
  const orig = cw.applyEffect.bind(cw);
  cw.applyEffect = (ev) => {
    replayed++;
    orig(ev);
  };
  hw.addPing(0);
  hw.players[0].hp = 50;
  for (const p of hw.players) p.invuln = 0;
  hw.enemies.length = 0;
  // Put an enemy on the host player so hurt effects fire.
  (hw as unknown as { spawnEnemyAt: (k: string, x: number, y: number) => void }).spawnEnemyAt("grunt", hw.players[0].x, hw.players[0].y);
  for (let i = 0; i < 30; i++) tick();
  const sent = wire.bin.reduce((n, b) => n + decodeSnapshot(b).effects.length, 0);
  expect(sent).toBeGreaterThan(0);
  expect(replayed).toBe(sent);
  expect(cw.pings).toHaveLength(1);
  expect(cw.enemies.some((e) => !e.dead)).toBe(true);
});

test("client reports hostPaused after 1.5 s without snapshots and clears it on the next snapshot", () => {
  startClient();
  for (let i = 0; i < 5; i++) tick();
  expect(client.hostPaused).toBe(false);
  now += 1600;
  client.frame(DT);
  expect(client.hostPaused).toBe(true);
  tick();
  tick();
  tick();
  expect(client.hostPaused).toBe(false);
});

test("client prediction moves the local robot and sends poses ~30/s", () => {
  startClient();
  const right = { ...IDLE_INPUT, moveX: 1 };
  const x0 = cw.players[1].x;
  for (let i = 0; i < 60; i++) {
    now += 1000 / 60;
    client.step(DT, right);
  }
  expect(cw.players[1].x).toBeGreaterThan(x0 + 100);
  const poses = cwire.text.filter((m) => m.t === "send" && (m.data as ClientToHost).k === "pose");
  expect(poses.length).toBeGreaterThanOrEqual(29);
  expect(poses.length).toBeLessThanOrEqual(31);
});

test("client prediction is frozen while downed", () => {
  startClient();
  hw.players[1].hp = 0;
  for (let i = 0; i < 3; i++) tick();
  expect(cw.players[1].downed).toBe(true);
  const x0 = cw.players[1].x;
  for (let i = 0; i < 30; i++) client.step(DT, { ...IDLE_INPUT, moveX: 1 });
  expect(cw.players[1].x).toBe(x0);
});

test("client cards arrive, pick sends the round, and the cards clear", () => {
  startClient();
  hw.pendingLevelUps = 1;
  const forward = () => {
    for (const m of wire.text.splice(0)) {
      if (m.t === "send" && (m.to === undefined || m.to === 1)) client.onHostMessage(m.data as HostToClient);
    }
  };
  tick();
  forward();
  expect(client.cards?.round).toBe(1);
  expect(client.waiting).toEqual([0, 1]);
  client.pick(1);
  expect(client.cards).toBeNull();
  const pick = cwire.text.find((m) => m.t === "send" && (m.data as ClientToHost).k === "pick");
  expect(pick).toMatchObject({ t: "send", data: { k: "pick", round: 1, index: 1 } });
});

test("a joiner's class reaches the host's run, and is forgotten when the slot frees up", () => {
  host.onClientMessage(1, { k: "hello", archetype: "vanguard" });
  host.start(SLOTS);
  expect(hw.players[1].armor).toBe(4);
  expect(wire.game().at(-1)).toMatchObject({ k: "start", slots: [{ slot: 0 }, { slot: 1, archetype: "vanguard" }] });

  host.onRoster([{ slot: 0, name: "HOST", connected: true }]);
  host.start(SLOTS);
  expect(hw.players[1].armor).toBe(0);
});

test("the host's own class in the slot list is kept", () => {
  host.start([{ slot: 0, name: "HOST", archetype: "vanguard" }, { slot: 1, name: "GUEST" }]);
  expect(hw.players[0].armor).toBe(4);
  expect(hw.players[1].armor).toBe(0);
});

test("client hello sends its class to the host", () => {
  startClient();
  client.hello("recon");
  expect(cwire.text.at(-1)).toEqual({ t: "send", data: { k: "hello", archetype: "recon" } });
});

test("a snapshot from a different game version is flagged, not thrown", () => {
  startClient();
  const bad = new Uint8Array([99, 0, 0, 0, 0]);
  expect(() => client.onSnapshot(bad.buffer)).not.toThrow();
  expect(client.versionMismatch).toBe(true);
});
