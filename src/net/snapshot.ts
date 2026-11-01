import { BOSS, ENEMIES, type EnemyKind } from "../game/config";
import type { Effect } from "../game/effects";
import type { Bullet, Enemy, EnemyBullet, Gem } from "../game/types";
import type { World } from "../game/world";

/**
 * A host's view of the world at one instant, as sent to co-op clients ~20x/s.
 * Pooled entities carry their pool index `i` so a client writes each one back
 * into the same slot — the renderer's per-slot robot/instance stays attached
 * to the same enemy, and positions can be interpolated between snapshots.
 */
export interface PlayerSnap {
  slot: number;
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  hp: number;
  maxHp: number;
  downed: boolean;
  reviveT: number;
  invuln: number;
  /** Orbital weapon level; radius/count derive from it. */
  orbital: number;
  orbitAngle: number;
  pickupRadius: number;
  kills: number;
  /** Build stats the client's own prediction and HUD read (upgrades only run on the host). */
  speed: number;
  blaster: number;
  nova: number;
  pingCd: number;
  recoilT: number;
}

export interface EnemySnap {
  i: number;
  kind: EnemyKind;
  x: number;
  y: number;
  flash: number;
  spawnT: number;
  punchT: number;
}

export interface PoolSnap {
  i: number;
  x: number;
  y: number;
  r: number;
}

export interface GemSnap extends PoolSnap {
  heal: boolean;
}

export interface Snapshot {
  seq: number;
  time: number;
  level: number;
  xp: number;
  xpToNext: number;
  /** Team kill count. */
  kills: number;
  /** Boss HP fraction, or -1 when no boss is alive. */
  bossHp: number;
  /** Bit per slot still choosing in an open level-up huddle. */
  waitingMask: number;
  gameOver: boolean;
  players: PlayerSnap[];
  enemies: EnemySnap[];
  bullets: PoolSnap[];
  enemyBullets: PoolSnap[];
  gems: GemSnap[];
  novaRings: { x: number; y: number; r: number }[];
  pings: { slot: number; x: number; y: number; life: number }[];
  effects: Effect[];
}

const KINDS: EnemyKind[] = ["grunt", "fast", "tank", "splitter", "shooter", "boss"];
const VERSION = 3;
/** A pooled bullet/gem that moved further than this between snapshots is a recycled slot, not motion. */
const REUSE_JUMP = 150;

// ---- Capture --------------------------------------------------------------

export function captureSnapshot(w: World, seq: number, waitingMask: number, effects: Effect[]): Snapshot {
  const pool = <T extends { dead: boolean; x: number; y: number; radius: number }>(arr: T[]): PoolSnap[] => {
    const out: PoolSnap[] = [];
    for (let i = 0; i < arr.length; i++) if (!arr[i].dead) out.push({ i, x: arr[i].x, y: arr[i].y, r: arr[i].radius });
    return out;
  };
  const enemies: EnemySnap[] = [];
  w.enemies.forEach((e, i) => {
    if (!e.dead) enemies.push({ i, kind: e.kind, x: e.x, y: e.y, flash: e.flash, spawnT: e.spawnT, punchT: e.punchT });
  });
  const gems: GemSnap[] = [];
  w.gems.forEach((g, i) => {
    if (!g.dead) gems.push({ i, x: g.x, y: g.y, r: g.radius, heal: g.kind === "heal" });
  });
  return {
    seq,
    time: w.time,
    level: w.level,
    xp: w.xp,
    xpToNext: w.xpToNext,
    kills: w.kills,
    bossHp: w.bossHpFraction ?? -1,
    waitingMask,
    gameOver: w.gameOver,
    players: w.players.map((p) => ({
      slot: p.slot, active: p.active, x: p.x, y: p.y, vx: p.vx, vy: p.vy, facing: p.facing,
      hp: p.hp, maxHp: p.maxHp, downed: p.downed, reviveT: p.reviveT, invuln: p.invuln,
      orbital: p.orbital, orbitAngle: p.orbitAngle, pickupRadius: p.pickupRadius, kills: p.kills,
      speed: p.speed, blaster: p.blaster, nova: p.nova, pingCd: p.pingCd, recoilT: p.recoilT,
    })),
    enemies,
    bullets: pool(w.bullets),
    enemyBullets: pool(w.enemyBullets),
    gems,
    novaRings: w.novaRings.map((n) => ({ x: n.x, y: n.y, r: n.r })),
    pings: w.pings.map((p) => ({ slot: p.slot, x: p.x, y: p.y, life: p.life })),
    effects,
  };
}

// ---- Binary encoding ---------------------------------------------------------

class Writer {
  private buf = new ArrayBuffer(4096);
  private view = new DataView(this.buf);
  private o = 0;

  private need(n: number): void {
    if (this.o + n <= this.buf.byteLength) return;
    const next = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.o + n));
    new Uint8Array(next).set(new Uint8Array(this.buf, 0, this.o));
    this.buf = next;
    this.view = new DataView(next);
  }
  u8(v: number): void { this.need(1); this.view.setUint8(this.o, v); this.o += 1; }
  u16(v: number): void { this.need(2); this.view.setUint16(this.o, v); this.o += 2; }
  u32(v: number): void { this.need(4); this.view.setUint32(this.o, v); this.o += 4; }
  f32(v: number): void { this.need(4); this.view.setFloat32(this.o, v); this.o += 4; }
  bytes(b: Uint8Array): void { this.need(b.length); new Uint8Array(this.buf, this.o, b.length).set(b); this.o += b.length; }
  done(): Uint8Array { return new Uint8Array(this.buf, 0, this.o); }
}

class Reader {
  private readonly view: DataView;
  private o = 0;
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8(): number { const v = this.view.getUint8(this.o); this.o += 1; return v; }
  u16(): number { const v = this.view.getUint16(this.o); this.o += 2; return v; }
  u32(): number { const v = this.view.getUint32(this.o); this.o += 4; return v; }
  f32(): number { const v = this.view.getFloat32(this.o); this.o += 4; return v; }
  take(n: number): Uint8Array { const b = this.bytes.subarray(this.o, this.o + n); this.o += n; return b; }
}

export function encodeSnapshot(s: Snapshot): Uint8Array {
  const w = new Writer();
  w.u8(VERSION);
  w.u32(s.seq);
  w.f32(s.time);
  w.u16(s.level);
  w.f32(s.xp);
  w.f32(s.xpToNext);
  w.u32(s.kills);
  w.f32(s.bossHp);
  w.u8(s.waitingMask);
  w.u8(s.gameOver ? 1 : 0);

  w.u8(s.players.length);
  for (const p of s.players) {
    w.u8(p.slot);
    w.u8((p.active ? 1 : 0) | (p.downed ? 2 : 0));
    for (const v of [p.x, p.y, p.vx, p.vy, p.facing, p.hp, p.maxHp, p.reviveT, p.invuln, p.orbitAngle, p.pickupRadius, p.speed, p.pingCd, p.recoilT]) {
      w.f32(v);
    }
    w.u8(p.orbital);
    w.u8(p.blaster);
    w.u8(p.nova);
    w.u16(p.kills);
  }

  w.u16(s.enemies.length);
  for (const e of s.enemies) {
    w.u16(e.i);
    w.u8(KINDS.indexOf(e.kind));
    w.f32(e.x);
    w.f32(e.y);
    w.f32(e.flash);
    w.f32(e.spawnT);
    w.f32(e.punchT);
  }

  for (const list of [s.bullets, s.enemyBullets]) {
    w.u16(list.length);
    for (const b of list) {
      w.u16(b.i);
      w.f32(b.x);
      w.f32(b.y);
      w.f32(b.r);
    }
  }

  w.u16(s.gems.length);
  for (const g of s.gems) {
    w.u16(g.i);
    w.f32(g.x);
    w.f32(g.y);
    w.f32(g.r);
    w.u8(g.heal ? 1 : 0);
  }

  w.u8(s.novaRings.length);
  for (const n of s.novaRings) {
    w.f32(n.x);
    w.f32(n.y);
    w.f32(n.r);
  }

  w.u8(s.pings.length);
  for (const p of s.pings) {
    w.u8(p.slot);
    w.f32(p.x);
    w.f32(p.y);
    w.f32(p.life);
  }

  const fx = new TextEncoder().encode(JSON.stringify(s.effects));
  w.u32(fx.length);
  w.bytes(fx);
  return w.done();
}

export function decodeSnapshot(buf: ArrayBuffer | Uint8Array): Snapshot {
  const r = new Reader(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  const version = r.u8();
  if (version !== VERSION) throw new Error(`snapshot version ${version} != ${VERSION}`);
  const s: Snapshot = {
    seq: r.u32(),
    time: r.f32(),
    level: r.u16(),
    xp: r.f32(),
    xpToNext: r.f32(),
    kills: r.u32(),
    bossHp: r.f32(),
    waitingMask: r.u8(),
    gameOver: r.u8() === 1,
    players: [],
    enemies: [],
    bullets: [],
    enemyBullets: [],
    gems: [],
    novaRings: [],
    pings: [],
    effects: [],
  };

  for (let n = r.u8(); n > 0; n--) {
    const slot = r.u8();
    const flags = r.u8();
    const [x, y, vx, vy, facing, hp, maxHp, reviveT, invuln, orbitAngle, pickupRadius, speed, pingCd, recoilT] =
      Array.from({ length: 14 }, () => r.f32());
    s.players.push({
      slot, active: (flags & 1) !== 0, downed: (flags & 2) !== 0,
      x, y, vx, vy, facing, hp, maxHp, reviveT, invuln, orbitAngle, pickupRadius, speed, pingCd, recoilT,
      orbital: r.u8(), blaster: r.u8(), nova: r.u8(), kills: r.u16(),
    });
  }

  for (let n = r.u16(); n > 0; n--) {
    s.enemies.push({ i: r.u16(), kind: KINDS[r.u8()], x: r.f32(), y: r.f32(), flash: r.f32(), spawnT: r.f32(), punchT: r.f32() });
  }

  for (const list of [s.bullets, s.enemyBullets]) {
    for (let n = r.u16(); n > 0; n--) list.push({ i: r.u16(), x: r.f32(), y: r.f32(), r: r.f32() });
  }

  for (let n = r.u16(); n > 0; n--) {
    s.gems.push({ i: r.u16(), x: r.f32(), y: r.f32(), r: r.f32(), heal: r.u8() === 1 });
  }

  for (let n = r.u8(); n > 0; n--) s.novaRings.push({ x: r.f32(), y: r.f32(), r: r.f32() });
  for (let n = r.u8(); n > 0; n--) s.pings.push({ slot: r.u8(), x: r.f32(), y: r.f32(), life: r.f32() });

  s.effects = JSON.parse(new TextDecoder().decode(r.take(r.u32()))) as Effect[];
  return s;
}

// ---- Apply (client side) -------------------------------------------------------

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Index a snapshot list by pool slot so `a`-side matches are O(1). */
function byIndex<T extends { i: number }>(list: T[]): Map<number, T> {
  const m = new Map<number, T>();
  for (const v of list) m.set(v.i, v);
  return m;
}

/** Grow a pool to at least `n` slots using `make`, then mark every slot dead. */
function resetPool<T extends { dead: boolean }>(arr: T[], n: number, make: () => T): void {
  while (arr.length < n) arr.push(make());
  for (const v of arr) v.dead = true;
}

const maxIndex = (list: { i: number }[]): number => list.reduce((m, v) => Math.max(m, v.i + 1), 0);

/**
 * Write the world as it was a fraction `t` (0..1) of the way from snapshot
 * `a` to snapshot `b` into a client's view World. The local player's own
 * position/heading are left alone — the client predicts those itself.
 */
export function applySnapshot(w: World, a: Snapshot, b: Snapshot, t: number, localSlot: number): void {
  w.time = lerp(a.time, b.time, t);
  w.level = b.level;
  w.xp = b.xp;
  w.xpToNext = b.xpToNext;
  w.kills = b.kills;
  w.gameOver = b.gameOver;
  w.bossHpOverride = b.bossHp < 0 ? null : b.bossHp;

  // Players
  const seenSlots = new Set<number>();
  for (const pb of b.players) {
    const p = w.players[pb.slot];
    if (!p) continue;
    seenSlots.add(pb.slot);
    const pa = a.players.find((q) => q.slot === pb.slot) ?? pb;
    if (pb.slot !== localSlot) {
      p.x = lerp(pa.x, pb.x, t);
      p.y = lerp(pa.y, pb.y, t);
      p.vx = pb.vx;
      p.vy = pb.vy;
      p.facing = pb.facing;
    }
    p.active = pb.active;
    p.hp = pb.hp;
    p.maxHp = pb.maxHp;
    p.downed = pb.downed;
    p.reviveT = pb.reviveT;
    p.invuln = pb.invuln;
    p.orbital = pb.orbital;
    p.orbitAngle = pb.orbitAngle;
    p.pickupRadius = pb.pickupRadius;
    p.kills = pb.kills;
    p.speed = pb.speed;
    p.blaster = pb.blaster;
    p.nova = pb.nova;
    p.pingCd = pb.pingCd;
    p.recoilT = pb.recoilT;
  }
  for (const p of w.players) if (!seenSlots.has(p.slot)) p.active = false;

  // Enemies
  const ea = byIndex(a.enemies);
  resetPool(w.enemies, maxIndex(b.enemies), newEnemy);
  for (const eb of b.enemies) {
    const e = w.enemies[eb.i];
    const prev = ea.get(eb.i);
    // A slot the host recycled for a fresh spawn restarts its spawn timer:
    // draw it where it is, not sliding over from the enemy that died there.
    const from = prev && prev.kind === eb.kind && eb.spawnT >= prev.spawnT ? prev : eb;
    const def = eb.kind === "boss" ? BOSS : ENEMIES[eb.kind];
    e.dead = false;
    e.kind = eb.kind;
    e.isBoss = eb.kind === "boss";
    e.x = lerp(from.x, eb.x, t);
    e.y = lerp(from.y, eb.y, t);
    e.flash = eb.flash;
    e.spawnT = eb.spawnT;
    e.punchT = eb.punchT;
    e.radius = def.radius;
    e.color = def.color;
    e.modelScale = def.modelScale;
    e.anim = def.anim;
    e.animSpeed = def.animSpeed;
  }

  applyPool(w.bullets, a.bullets, b.bullets, t, newBullet);
  applyPool(w.enemyBullets, a.enemyBullets, b.enemyBullets, t, newEnemyBullet);

  // Gems
  const ga = byIndex(a.gems);
  resetPool(w.gems, maxIndex(b.gems), newGem);
  for (const gb of b.gems) {
    const g = w.gems[gb.i];
    const from = sameEntity(ga.get(gb.i), gb);
    g.dead = false;
    g.x = lerp(from.x, gb.x, t);
    g.y = lerp(from.y, gb.y, t);
    g.radius = gb.r;
    g.kind = gb.heal ? "heal" : "xp";
  }

  w.novaRings.length = 0;
  for (const n of b.novaRings) w.novaRings.push({ x: n.x, y: n.y, r: n.r, maxR: n.r, life: 1, dead: false });
  w.pings.length = 0;
  for (const p of b.pings) w.pings.push({ ...p });
}

function applyPool<T extends { dead: boolean; x: number; y: number; radius: number }>(
  arr: T[], a: PoolSnap[], b: PoolSnap[], t: number, make: () => T,
): void {
  const prev = byIndex(a);
  resetPool(arr, maxIndex(b), make);
  for (const sb of b) {
    const v = arr[sb.i];
    const from = sameEntity(prev.get(sb.i), sb);
    v.dead = false;
    v.x = lerp(from.x, sb.x, t);
    v.y = lerp(from.y, sb.y, t);
    v.radius = sb.r;
  }
}

/** `a` if it is plausibly the same pooled entity as `b` one snapshot later, else `b` (no interpolation). */
function sameEntity<T extends PoolSnap>(a: T | undefined, b: T): T {
  if (!a) return b;
  return Math.abs(b.x - a.x) > REUSE_JUMP || Math.abs(b.y - a.y) > REUSE_JUMP ? b : a;
}

const newEnemy = (): Enemy => ({
  x: 0, y: 0, vx: 0, vy: 0, radius: 10, hp: 1, maxHp: 1, speed: 0,
  touchDamage: 0, xp: 0, kind: "grunt", color: "#fff",
  modelScale: 1, anim: "Idle", animSpeed: 1,
  dead: true, flash: 0, kbx: 0, kby: 0, shootCd: 0,
  isBoss: false, spawnT: 0, punchT: 0,
});
const newBullet = (): Bullet => ({
  x: 0, y: 0, vx: 0, vy: 0, radius: 5, damage: 0, pierce: 0, life: 0, dead: true, crit: false, hitCd: 0, owner: 0,
});
const newEnemyBullet = (): EnemyBullet => ({ x: 0, y: 0, vx: 0, vy: 0, radius: 7, damage: 0, life: 0, dead: true });
const newGem = (): Gem => ({ x: 0, y: 0, vx: 0, vy: 0, radius: 7, value: 0, dead: true, magnet: false, kind: "xp" });
