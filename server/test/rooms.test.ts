import { beforeEach, expect, test } from "vitest";
import { RoomManager, type Conn } from "../src/rooms";
import { CODE_ALPHABET, type RelayToClient } from "../../src/net/relayProtocol";

class FakeConn implements Conn {
  sent: (string | Uint8Array)[] = [];
  closed = false;
  send(d: string | Uint8Array): void {
    this.sent.push(d);
  }
  close(): void {
    this.closed = true;
  }
  msgs(): RelayToClient[] {
    return this.sent.filter((s): s is string => typeof s === "string").map((s) => JSON.parse(s));
  }
  last<T extends RelayToClient["t"]>(t: T): Extract<RelayToClient, { t: T }> | undefined {
    return this.msgs().filter((m) => m.t === t).at(-1) as Extract<RelayToClient, { t: T }> | undefined;
  }
  binaries(): Uint8Array[] {
    return this.sent.filter((s): s is Uint8Array => typeof s !== "string");
  }
}

let now = 0;
let rm: RoomManager;
const send = (c: Conn, m: unknown) => rm.onText(c, JSON.stringify(m));
const open = () => {
  const c = new FakeConn();
  rm.onOpen(c);
  return c;
};
const hostRoom = () => {
  const host = open();
  send(host, { t: "host", name: "HOSTY" });
  return { host, code: host.last("welcome")!.code };
};
const joinRoom = (code: string, name = "GUEST") => {
  const c = open();
  send(c, { t: "join", code, name });
  return c;
};

beforeEach(() => {
  now = 1000;
  rm = new RoomManager(() => now);
});

test("host gets a 4-char code and slot 0", () => {
  const { host, code } = hostRoom();
  expect(code).toHaveLength(4);
  for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
  expect(host.last("welcome")!.slot).toBe(0);
  expect(rm.roomCount).toBe(1);
});

test("join puts the player in the next free slot and broadcasts a roster to everyone", () => {
  const { host, code } = hostRoom();
  const a = joinRoom(code, "ALPHA");
  expect(a.last("welcome")!.slot).toBe(1);
  const roster = host.last("roster")!;
  expect(roster.players).toEqual([
    { slot: 0, name: "HOSTY", connected: true },
    { slot: 1, name: "ALPHA", connected: true },
  ]);
  expect(a.last("roster")!.players).toHaveLength(2);
});

test("join errors: unknown code, full room, started run, bad code", () => {
  const { host, code } = hostRoom();
  const missing = joinRoom(code === "ZZZZ" ? "YYYY" : "ZZZZ");
  expect(missing.last("error")!.reason).toBe("not_found");
  joinRoom(code);
  joinRoom(code);
  joinRoom(code);
  expect(joinRoom(code).last("error")!.reason).toBe("full");
  const { host: h2, code: c2 } = hostRoom();
  send(h2, { t: "start" });
  expect(joinRoom(c2).last("error")!.reason).toBe("started");
  expect(joinRoom("ab0d").last("error")!.reason).toBe("bad_code");
  void host;
});

test('client "send" reaches only the host as {t:"msg", from: slot}', () => {
  const { host, code } = hostRoom();
  const a = joinRoom(code);
  const b = joinRoom(code);
  send(b, { t: "send", data: { k: "ping" } });
  expect(host.last("msg")).toEqual({ t: "msg", from: 2, data: { k: "ping" } });
  expect(a.last("msg")).toBeUndefined();
});

test('host "send" with to reaches one client; without to reaches all clients', () => {
  const { host, code } = hostRoom();
  const a = joinRoom(code);
  const b = joinRoom(code);
  send(host, { t: "send", to: 2, data: { k: "x" } });
  expect(b.last("msg")).toEqual({ t: "msg", from: 0, data: { k: "x" } });
  expect(a.last("msg")).toBeUndefined();
  send(host, { t: "send", data: { k: "y" } });
  expect(a.last("msg")!.data).toEqual({ k: "y" });
  expect(b.last("msg")!.data).toEqual({ k: "y" });
  expect(host.last("msg")).toBeUndefined();
});

test("host binary frame is forwarded to all clients, client binary is dropped", () => {
  const { host, code } = hostRoom();
  const a = joinRoom(code);
  const b = joinRoom(code);
  rm.onBinary(host, new Uint8Array([1, 2, 3]));
  expect(a.binaries()).toEqual([new Uint8Array([1, 2, 3])]);
  expect(b.binaries()).toHaveLength(1);
  rm.onBinary(a, new Uint8Array([9]));
  expect(host.binaries()).toHaveLength(0);
  expect(b.binaries()).toHaveLength(1);
});

test("client disconnect keeps the slot for 10 s; rejoin with token restores it", () => {
  const { host, code } = hostRoom();
  const a = joinRoom(code);
  const token = a.last("welcome")!.token;
  rm.onClose(a);
  expect(host.last("roster")!.players[1]).toEqual({ slot: 1, name: "GUEST", connected: false });
  now += 9000;
  rm.tick();
  const a2 = open();
  send(a2, { t: "rejoin", code, token });
  expect(a2.last("welcome")).toMatchObject({ code, slot: 1, token });
  expect(host.last("roster")!.players[1].connected).toBe(true);
});

test("client disconnect past 10 s removes the slot", () => {
  const { host, code } = hostRoom();
  const a = joinRoom(code);
  rm.onClose(a);
  now += 10_001;
  rm.tick();
  expect(host.last("roster")!.players).toHaveLength(1);
  // The freed slot is reusable.
  expect(joinRoom(code).last("welcome")!.slot).toBe(1);
});

test("rejoin with wrong token is refused", () => {
  const { code } = hostRoom();
  const a = joinRoom(code);
  rm.onClose(a);
  const a2 = open();
  send(a2, { t: "rejoin", code, token: "nope" });
  expect(a2.last("error")!.reason).toBe("bad_token");
});

test("host disconnect closes the room for everyone", () => {
  const { host, code } = hostRoom();
  const a = joinRoom(code);
  rm.onClose(host);
  expect(a.last("closed")).toEqual({ t: "closed", reason: "host_left" });
  expect(a.closed).toBe(true);
  expect(rm.roomCount).toBe(0);
});

test('"lobby" from host unlocks joins again', () => {
  const { host, code } = hostRoom();
  send(host, { t: "start" });
  expect(joinRoom(code).last("error")!.reason).toBe("started");
  send(host, { t: "lobby" });
  expect(joinRoom(code).last("welcome")!.slot).toBe(1);
});

test("only the host can start", () => {
  const { host, code } = hostRoom();
  const a = joinRoom(code);
  send(a, { t: "start" });
  expect(host.last("start")).toBeUndefined();
  send(host, { t: "start" });
  expect(a.last("start")).toEqual({ t: "start" });
});

test("codes never collide with a live room", () => {
  // A rand that yields the same code twice, then a different one.
  const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
  let i = 0;
  rm = new RoomManager(() => now, () => seq[i++ % seq.length]);
  const a = hostRoom();
  const b = hostRoom();
  expect(b.code).not.toBe(a.code);
});

test("invalid JSON is ignored", () => {
  const c = open();
  expect(() => rm.onText(c, "{nope")).not.toThrow();
  expect(c.sent).toHaveLength(0);
});
