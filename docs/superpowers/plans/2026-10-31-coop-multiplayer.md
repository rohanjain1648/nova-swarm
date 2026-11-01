# NOVA SWARM Co-op Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2–4 player co-op runs joined by room code/link, with team XP, personal builds, downed/revive, and pings, while solo play stays exactly as it is.

**Architecture:**
- **Host-authoritative simulation.** The host's browser runs the real `World` with N players. Each client is authoritative only for its own robot's pose, which it predicts locally and sends ~30×/s. The host broadcasts binary snapshots ~20×/s.
- **Clients don't simulate.** A client keeps a `World` it never `update()`s. It writes interpolated snapshots into that `World`'s pools and replays cosmetic effect events.
- **Relay.** A small Node `ws` server on Render does room bookkeeping and forwards messages. It contains no game logic.

**Tech Stack:** TypeScript 5.6, Vite 5, Three.js 0.185, vitest (new, unit tests), Node 22 + `ws` + `tsx` (relay), Playwright (smoke tests), Render (relay hosting), Vercel (static site, unchanged).

**Spec:** `docs/superpowers/specs/2026-10-31-coop-multiplayer-design.md`

## Global Constraints

- Solo play must stay exactly as it is. `npm run smoke` passes unchanged after every task. With 1 player, every co-op multiplier equals 1.
- Max 4 players per room. Room codes are 4 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no `O/0/I/1`). Invite link: `?room=ABCD`.
- Huddle auto-pick after 15 s. Revive: stand within range for 3 s, revived at 30% HP. Ping lasts 4 s, at most 1 per player per 2 s, key `G`.
- Difficulty: spawn rate ×(1 + 0.6·(n−1)), enemy HP ×(1 + 0.3·(n−1)), where n = active players.
- Snapshots ~20 Hz, binary. Poses ~30 Hz. Reconnect grace 10 s using a session token. Host leaving closes the room.
- The co-op best time is stored under `novaswarm.best.coop`. The solo key `novaswarm.best` is never written by co-op.
- The relay URL comes from `VITE_RELAY_URL` (a `wss://` URL). If it is unset or unreachable, the co-op buttons show "Co-op unavailable" and Solo still works. While the relay is waking, they show "Waking co-op server…".
- The relay serves `GET /health` (200, `Access-Control-Allow-Origin: *`) and listens on `process.env.PORT ?? 8787`.
- Slot colours: P1 `#3fe9ff` (today's player cyan), P2 `#5dffb0`, P3 `#5b7bff`, P4 `#f2f5ff`. None of these is an enemy tint.
- `nova-mobile/` is not touched.
- New tuning constants go in `src/game/config.ts` as `export const COOP = {...}`. Do not scatter literals.

## Review Focus

1. **A player disconnects mid-huddle.** The huddle must not wait forever for them. Waiting excludes inactive players, and the huddle completes as soon as all remaining players have picked. Test in Task 7.
2. **The host's tab goes to the background.** `requestAnimationFrame` stops and snapshots stop. Clients must show "Host paused" after 1.5 s with no snapshot, and must not freeze silently or crash. The host must not enter the solo `paused` state on `visibilitychange` in co-op. Test in Task 7.
3. **A typed code has mixed case, spaces, or confusable characters** (`" abcd "`, `"AB0D"`). The code is normalized, invalid codes are rejected with a clear message, and no socket is opened. Test in Task 4.
4. **The last living player is removed** (disconnected past the grace period) while the others are downed. This must end the run, not leave a run that nobody can finish. Test in Task 3.
5. **Two level-ups queue at once** (`pendingLevelUps === 2`) in co-op. Each player gets two consecutive rounds of cards, and the round number keeps a late pick from round 1 from being applied to round 2. Test in Task 7.

---

## File map

| File | Responsibility |
|---|---|
| `src/game/types.ts` (modify) | + `PlayerInput`, `IDLE_INPUT`; `Bullet.owner` |
| `src/game/effects.ts` (new) | `Effect` union + `applyEffect` — the single place that turns an effect into audio/particles/flash/trauma |
| `src/game/world.ts` (modify) | N players, effects via `emit`, downed/revive, pings, co-op level-up API |
| `src/game/player.ts` (modify) | slot/name/active/downed/revive/kills/taken/remote fields |
| `src/game/upgrades.ts` (modify) | `UpgradeCard`, `toCard` |
| `src/game/config.ts` (modify) | `COOP` constants |
| `src/core/input.ts` (modify) | `read(): PlayerInput`, ping edge |
| `src/net/relayProtocol.ts` (new) | relay message types + code helpers — imported by client **and** server |
| `src/net/gameProtocol.ts` (new) | host↔client game message types |
| `src/net/snapshot.ts` (new) | `Snapshot` type, `encodeSnapshot`/`decodeSnapshot`, `captureSnapshot`, `applySnapshot` |
| `src/net/relayClient.ts` (new) | WebSocket client, reconnect, `wakeRelay` |
| `src/net/hostSession.ts` (new) | host loop: inputs → World, huddle, snapshots |
| `src/net/clientSession.ts` (new) | client loop: prediction, poses, interpolation, host-paused detection |
| `src/render/worldView.ts`, `src/render/camera3d.ts`, `src/ui/hud.ts` (modify) | multi-robot rendering, teammate HUD, edge arrows, pings |
| `src/ui/screens.ts` (modify), `src/ui/lobby.ts` (new), `src/ui/codeInput.ts` (new) | title buttons, lobby/join screens, DOM code entry |
| `src/main.ts` (modify) | state machine wiring for co-op |
| `server/` (new) | `package.json`, `tsconfig.json`, `src/rooms.ts` (pure room logic), `src/main.ts` (http + ws), `test/rooms.test.ts` |
| `render.yaml` (new) | Render blueprint |
| `vitest.config.ts`, `test/unit/*.test.ts` (new) | unit tests |
| `test/coop-smoke.mjs` (new) | two-browser smoke test |

---

### Task 1: Unit-test harness and an input struct for the simulation

**Files:**
- Create: `vitest.config.ts`, `test/unit/helpers.ts`, `test/unit/world.solo.test.ts`
- Modify: `package.json`, `src/game/types.ts`, `src/core/input.ts`, `src/game/world.ts`, `src/main.ts`

**Interfaces:**
- Produces:
  - `interface PlayerInput { moveX: number; moveY: number; aimActive: boolean; aimX: number; aimY: number; firing: boolean }`
  - `const IDLE_INPUT: Readonly<PlayerInput>` (all zero/false, `aimX: 1`)
  - `Input.read(): PlayerInput`. Calls the existing private recompute, then returns `firing = aim.active || touchSteering`.
  - `World.update(dt: number, inputs: readonly PlayerInput[]): void`. In this task it uses `inputs[0]` only. `World` no longer calls `input.update()`.
  - `test/unit/helpers.ts`:
    - `silentAudio(): Audio` (a Proxy whose every method is a no-op and `muted` is `false`)
    - `runFor(world, seconds, inputs)` (steps at 1/60)

- [ ] **Step 1:** Add the devDependency `vitest@^2.1.8` and the script `"test": "vitest run"`. Add `vitest.config.ts` with `test.include = ["test/unit/**/*.test.ts", "server/test/**/*.test.ts"]` and `environment: "node"`.
- [ ] **Step 2: Write the failing characterization test** `test/unit/world.solo.test.ts`:

```ts
test("solo world advances time, spawns enemies, and the idle player eventually dies", () => {
  const w = new World(silentAudio());
  runFor(w, 90, [IDLE_INPUT]);
  expect(w.time).toBeGreaterThan(5);
  expect(w.enemies.some((e) => !e.dead) || w.gameOver).toBe(true);
});
test("a firing player kills enemies and gains XP", () => {
  const w = new World(silentAudio());
  runFor(w, 40, [{ ...IDLE_INPUT, firing: true, aimActive: true, aimX: 1, aimY: 0 }]);
  expect(w.kills).toBeGreaterThan(0);
});
```

- [ ] **Step 3:** Run `npm test`. Expected: FAIL, because `IDLE_INPUT` is not exported and `update` takes `Input`.
- [ ] **Step 4:** Implement the interfaces above. `World.update` derives the steering, facing and firing logic from `PlayerInput` exactly as it does from `Input` today. `main.ts` calls `world.update(dt, [input.read()])`.
- [ ] **Step 5:** Run `npm test && npm run typecheck && npm run build && npm run smoke`. Expected: all pass.
- [ ] **Step 6:** Commit: `test: add vitest harness; decouple World.update from Input`.

### Task 2: Route every side-effect through an `Effect` list

**Files:**
- Create: `src/game/effects.ts`, `test/unit/effects.test.ts`
- Modify: `src/game/world.ts`

**Interfaces:**
- Produces in `src/game/effects.ts`:

```ts
export type Sfx = "shoot" | "hit" | "kill" | "bigKill" | "hurt" | "pickup" | "levelup" | "bossWarn";
export type Effect =
  | { k: "sfx"; n: Sfx; slot: number }                  // slot -1 = everyone
  | { k: "spark"; x: number; y: number; color: string; count: number; speed: number; size: number }
  | { k: "text"; x: number; y: number; text: string; color: string; size: number }
  | { k: "flash"; color: string; i: number; slot: number }
  | { k: "trauma"; v: number; slot: number };
export interface EffectTarget { particles: Particles; flash(color: string, i: number): void; addTrauma(v: number): void }
export function applyEffect(t: EffectTarget, audio: Audio, ev: Effect, localSlot: number): void
```

  Effects with `slot !== -1 && slot !== localSlot` are skipped. This keeps a teammate's hurt flash and shoot sound off your screen.
- `World`:
  - `recordEffects = false`. When this is true, `emit` also pushes to an internal buffer.
  - `drainEffects(): Effect[]` returns the buffer and clears it.
  - `applyEffect(ev: Effect): void` is public (used by clients).
  - `localSlot = 0`.
  - `tickCosmetics(dt: number): void` advances particles, decays `flashT`, and sets the music intensity. `update` calls it, and so do clients.
  - `flash` and `addTrauma` become public, to satisfy `EffectTarget`.

- [ ] **Step 1: Write failing tests:**
  - `emit records only when recordEffects is true`: run 10 s firing with `recordEffects = true`. `drainEffects()` contains `{k:"sfx", n:"shoot"}`. A second drain is empty.
  - `applyEffect skips effects targeted at another slot`: a `flash` with `slot: 1` and `localSlot: 0` leaves `flashT === 0`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL (the module is missing).
- [ ] **Step 3:** Implement. Replace every direct `this.audio.*`, `this.particles.spark/text`, `this.flash` and `this.addTrauma` call in `World` (other than inside `applyEffect`) with `this.emit({...})`. The values must not change. Player-specific effects (shoot, hurt, the hurt flash, the hurt trauma) carry the player's slot. Everything else uses `-1`.
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run build && npm run smoke`. Expected: all pass.
- [ ] **Step 5:** Commit: `refactor: route World side-effects through Effect events`.

### Task 3: Multi-player World

**Files:**
- Modify: `src/game/config.ts`, `src/game/player.ts`, `src/game/types.ts`, `src/game/world.ts`, `src/game/enemies.ts`, `src/game/upgrades.ts`
- Create: `test/unit/world.coop.test.ts`

**Interfaces:**
- Consumes: Task 1 and Task 2 APIs.
- Produces:
  - `COOP` in `config.ts`:

```ts
export const COOP = {
  maxPlayers: 4, spawnPerExtra: 0.6, hpPerExtra: 0.3,
  reviveRange: 70, reviveSeconds: 3, reviveHpFrac: 0.3,
  huddleTimeoutSec: 15, pingLifeSec: 4, pingCooldownSec: 2,
  snapshotHz: 20, poseHz: 30, poseMaxLagSec: 0.25,
  interpDelayMs: 100, hostPausedMs: 1500, reconnectGraceMs: 10_000,
  slotColors: ["#3fe9ff", "#5dffb0", "#5b7bff", "#f2f5ff"],
} as const;
```

  - New `Player` fields:
    - `slot`, `name`
    - `active = true`
    - `downed = false`
    - `reviveT = 0` (0..1 progress)
    - `remote = false`
    - `remoteFiring = false`
    - `kills = 0`
    - `taken: Record<string, number> = {}` (moved here from `World`)
    - `pingCd = 0`

    `reset()` clears all of them except `slot`, `name` and `active`.
  - `Bullet.owner: number`, which is the shooter's slot.
  - `World` changes:
    - `players: Player[]`
    - `get player(): Player`, which returns `players[localSlot]`
    - `reset(slots: { slot: number; name: string }[] = [{ slot: 0, name: "YOU" }])`
    - `activeCount`
  - `World.stepPlayerMovement(p: Player, inp: PlayerInput, dt: number): void`. This is today's `movePlayer` plus facing, made public for client prediction.
  - `World.setRemotePose(slot: number, x: number, y: number, facing: number, firing: boolean): void`:
    - It clamps the displacement from the current position to at most `p.speed * COOP.poseMaxLagSec`.
    - It derives `vx/vy` from the displacement over the elapsed sim time since the last pose.
  - `World.removePlayer(slot)`: sets `active = false` and kills that player's bullets.
  - `World.addPing(slot): boolean`. It returns `false` while the player is on cooldown or downed. `pings: { slot: number; x: number; y: number; life: number }[]`.
  - Level-up API:
    - `rollUpgradeChoices(slot): Upgrade[]`
    - `applyUpgrade(slot, u)`, which no longer touches `pendingLevelUps`
    - `finishLevelUp()`: decrements `pendingLevelUps`, emits the `levelup` sfx and flash
  - `upgrades.ts`: `interface UpgradeCard { id; name; icon; color; label; desc }` (all strings), plus `toCard(u: Upgrade, p: Player): UpgradeCard`.
  - `Director.update` takes a `spawnRateMul: number`. It multiplies the batch count by that rate and rounds probabilistically with `rng`. With a multiplier of 1 it makes no extra `rng` calls.
  - `initEnemy` takes an `hpMul` parameter (default 1).

- [ ] **Step 1: Write failing tests** in `test/unit/world.coop.test.ts`. They use `new World(silentAudio())` and `w.reset([{slot:0,name:"A"},{slot:1,name:"B"}])`:
  - `enemies chase the nearest living player`: put P0 at (0,0) downed and P1 at (500,0). Spawn one grunt at (300,0) by stepping until the first enemy exists, then teleport it. After 1 s its `x` has increased.
  - `downed player is revived by a teammate standing close for 3 s`: P0 is downed at (0,0) and P1 is at (40,0). After 3.1 s, P0 has `downed === false` and `hp === Math.round(maxHp * 0.3)` (±1).
  - `revive progress resets when the teammate walks away`: run 1.5 s near, then move P1 to (500,0). After a further 0.1 s, `reviveT === 0`.
  - `run ends only when all active players are downed`: P0 downed, P1 alive gives `gameOver === false`. Then P1 downed gives `gameOver === true`.
  - `removing the last living player ends the run` (Review Focus 4): P0 downed, `removePlayer(1)`, one step gives `gameOver === true`.
  - `XP from any player's pickup goes to the team pool`: drop a gem on P1. `w.xp` increases.
  - `kills are credited to the shooter`: only P1 fires. After 30 s, `players[1].kills > 0` and `players[0].kills === 0`.
  - `difficulty scales with active count`: an enemy spawned with 2 active players has `maxHp === Math.round(base * hpScale(t) * 1.3)`.
  - `setRemotePose clamps teleports`: a pose 5000 units away moves the player at most `speed * 0.25`.
  - `addPing respects cooldown`: `addPing(0)` is true, the next call is false, and after 2.01 s it is true again.
  - `solo reset keeps one player and multipliers at 1`: `players.length === 1`.
- [ ] **Step 2:** Run `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement:
  - Every per-player system loops over the active players that are not downed:
    - movement for local/non-remote players, using `inputs[slot] ?? IDLE_INPUT`
    - weapons
    - enemy-bullet hits
    - contact damage
    - gem magnet, toward the nearest living player
  - Downed:
    - At `hp <= 0` a player becomes `downed`, emits the `down` effects (the same ones as today's `die()`), and stops moving or firing. Enemies ignore downed players.
    - Revive: if any living teammate is within `reviveRange`, `reviveT += dt / reviveSeconds`, otherwise `reviveT = 0`.
    - `gameOver` is set when no active player is alive.
  - Spawning: the spawn centre is a random living player. Do not call `rng` when there is only one.
  - Knockback direction is measured from the damaging player.
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run build && npm run smoke`. Expected: all pass, and solo is unchanged.
- [ ] **Step 5:** Commit: `feat(game): multi-player World with downed/revive, team XP, pings`.

### Task 4: Relay protocol and Node relay server

**Files:**
- Create:
  - `src/net/relayProtocol.ts`
  - `server/package.json`, `server/tsconfig.json`
  - `server/src/rooms.ts`, `server/src/main.ts`
  - `server/test/rooms.test.ts`
  - `render.yaml`
  - `test/unit/relayProtocol.test.ts`
- `.gitignore` already ignores `node_modules/` at every depth, so no change is needed.

**Interfaces:**
- Produces in `src/net/relayProtocol.ts` (no DOM or Node imports):

```ts
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function normalizeCode(raw: string): string | null; // trim, uppercase, exactly 4 chars from CODE_ALPHABET
export interface RosterEntry { slot: number; name: string; connected: boolean }
export type ErrorReason = "not_found" | "full" | "started" | "bad_code" | "bad_token";
export type ClientToRelay =
  | { t: "host"; name: string } | { t: "join"; code: string; name: string }
  | { t: "rejoin"; code: string; token: string } | { t: "start" } | { t: "lobby" }
  | { t: "send"; to?: number; data: unknown };          // host: to=slot or all clients; client: always to host
export type RelayToClient =
  | { t: "welcome"; code: string; slot: number; token: string }
  | { t: "roster"; players: RosterEntry[]; started: boolean }
  | { t: "error"; reason: ErrorReason } | { t: "start" } | { t: "lobby" }
  | { t: "msg"; from: number; data: unknown } | { t: "closed"; reason: "host_left" };
```

  Binary frames from the host are forwarded unchanged to every connected client. Binary frames from clients are dropped.
- `server/src/rooms.ts`:
  - `interface Conn { send(data: string | Uint8Array): void; close(): void }`
  - `class RoomManager`:
    - `constructor(now: () => number = Date.now, rand = Math.random)`
    - `onOpen(c: Conn)`, `onText(c: Conn, raw: string)`, `onBinary(c: Conn, data: Uint8Array)`, `onClose(c: Conn)`
    - `tick()`: expires grace periods. `main.ts` calls it every 1 s.
    - `roomCount`
- `server/src/main.ts`:
  - An `http.createServer` that answers `GET /health` with `200 ok` plus CORS `*`.
  - A `WebSocketServer({ server })` that maps sockets to `Conn`s.
  - Port from `PORT ?? 8787`.
- `server/package.json`:
  - deps: `ws@^8.18.0`, `tsx@^4.19.2`
  - devDeps: `@types/ws`, `@types/node@^22`, `typescript@^5.6.3`
  - scripts: `"start": "tsx src/main.ts"`, `"dev": "tsx watch src/main.ts"`, `"typecheck": "tsc --noEmit"`
- `server/tsconfig.json` includes `src` and `../src/net/relayProtocol.ts`.

- [ ] **Step 1: Write failing tests:**
  - `relayProtocol.test.ts` (Review Focus 3):
    - `normalizeCode(" abcd ") === "ABCD"`
    - `normalizeCode("AB0D") === null`
    - `normalizeCode("ABC") === null`
    - `normalizeCode("ABCDE") === null`
  - `server/test/rooms.test.ts` uses fake `Conn`s that record sent frames:
    - `host gets a 4-char code and slot 0`
    - `join puts the player in the next free slot and broadcasts a roster to everyone`
    - `join errors: unknown code → not_found; 5th player → full; after start → started; bad code → bad_code`
    - `client "send" reaches only the host as {t:"msg", from: slot}`
    - `host "send" with to reaches one client; without to reaches all clients`
    - `host binary frame is forwarded to all clients, client binary is dropped`
    - `client disconnect keeps the slot for 10 s (roster connected:false); rejoin with token restores it`
    - `client disconnect past 10 s removes the slot (advance fake now, call tick)`
    - `rejoin with wrong token → bad_token`
    - `host disconnect sends {t:"closed", reason:"host_left"} to all and deletes the room`
    - `"lobby" from host unlocks joins again`
    - `codes never collide with a live room` (inject a `rand` that repeats once)
- [ ] **Step 2:** Run `npm --prefix server install && npm test`. Expected: FAIL (the modules are missing).
- [ ] **Step 3:** Implement. Messages from non-host connections other than `send`, `join`, `rejoin` and `host` are ignored. Invalid JSON is ignored, never fatal. Names are trimmed to 12 characters.
- [ ] **Step 4:** Add `render.yaml`:

```yaml
services:
  - type: web
    name: novaswarm-relay
    runtime: node
    plan: free
    buildCommand: npm --prefix server ci
    startCommand: npm --prefix server start
    healthCheckPath: /health
    envVars:
      - key: NODE_VERSION
        value: "22"
```

- [ ] **Step 5:** Run `npm test && npm --prefix server run typecheck`. Expected: PASS. Then run the manual check `npm --prefix server run dev` followed by `curl localhost:8787/health`. Expected: `ok`.
- [ ] **Step 6:** Commit: `feat(relay): Node WebSocket relay with rooms, reconnect grace, Render blueprint`.

### Task 5: Snapshots — capture, binary encode/decode, apply with interpolation

**Files:**
- Create: `src/net/snapshot.ts`, `test/unit/snapshot.test.ts`
- Modify: `src/game/world.ts` (adds `bossHpOverride: number | null = null`, which `bossHpFraction` returns when it is non-null)

**Interfaces:**
- Consumes: the Task 3 `World` and `Player`, and the Task 2 `Effect`.
- Produces:

```ts
export interface PlayerSnap { slot; active; x; y; vx; vy; facing; hp; maxHp; downed; reviveT; invuln;
  orbital; orbitAngle; orbitalRadius; pickupRadius; kills }          // numbers/booleans
export interface EnemySnap { i: number; kind: EnemyKind; x; y; flash; spawnT }
export interface Snapshot { seq: number; time; level; xp; xpToNext; bossHp: number /* -1 none */;
  waitingMask: number /* bit per slot still picking in a huddle */; gameOver: boolean;
  players: PlayerSnap[]; enemies: EnemySnap[]; bullets: {x;y;r}[]; enemyBullets: {x;y;r}[];
  gems: {x;y;r;heal:boolean}[]; novaRings: {x;y;r}[]; pings: {slot;x;y;life}[]; effects: Effect[] }
export function captureSnapshot(w: World, seq: number, waitingMask: number, effects: Effect[]): Snapshot
export function encodeSnapshot(s: Snapshot): Uint8Array
export function decodeSnapshot(buf: ArrayBuffer | Uint8Array): Snapshot
export function applySnapshot(w: World, a: Snapshot, b: Snapshot, t: number, localSlot: number): void
```

- **Encoding:**
  - A `DataView` writes a fixed header, then counted arrays.
  - Positions are `Float32`.
  - Enemy kind is a `Uint8` index into a fixed kind list.
  - Booleans are packed into `Uint8`.
  - `effects` is a trailing length-prefixed UTF-8 JSON string.
  - Field order is the builder's choice.
- **`applySnapshot`:**
  - It linearly interpolates `x/y` of enemies (matched by `i`), players and bullets between `a` and `b` (`t` is in 0..1). If an entity is missing from `a`, it uses `b`'s values.
  - It writes enemies into `w.enemies[i]` and grows the pool if needed. Pool slots missing from `b` get `dead = true`. Colour, `modelScale`, `anim` and `animSpeed` come from `ENEMIES`/`BOSS` by kind.
  - It never writes `x, y, vx, vy, facing` of the player at `localSlot`.

- [ ] **Step 1: Write failing tests:**
  - `encode → decode round-trips` a hand-built snapshot with 2 players, 3 enemies (including a boss), bullets, gems, a ping and 2 effects. All numbers must match within 1e-3. Kinds, booleans and effects must be equal.
  - `a 70-enemy snapshot encodes under 4 KB` (`DIRECTOR.maxEnemies` is 70; 20 Hz × 4 KB = 80 KB/s is the worst case, and the typical case is well under the 50 KB/s budget).
  - `applySnapshot interpolates enemy positions`: with `a.x=0`, `b.x=100` and `t=0.25`, `w.enemies[i].x === 25`.
  - `applySnapshot marks absent enemy slots dead`.
  - `applySnapshot leaves the local player's position alone but updates its hp/downed`.
  - `captureSnapshot from a live 2-player World round-trips through encode/decode`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(net): binary world snapshots with interpolated apply`.

### Task 6: Relay client and server wake-up

**Files:**
- Create: `src/net/relayClient.ts`, `test/unit/relayClient.test.ts`

**Interfaces:**
- Consumes: Task 4 `relayProtocol.ts`, and `RoomManager` (the test starts a real relay in-process).
- Produces:

```ts
export type RelayStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";
export class RelayClient {
  constructor(url: string, socketCtor: typeof WebSocket = WebSocket);
  status: RelayStatus; slot: number; code: string;
  onMessage: (m: RelayToClient) => void;       // every text frame except welcome (handled internally too)
  onBinary: (data: ArrayBuffer) => void;
  onStatus: (s: RelayStatus) => void;
  host(name: string): Promise<{ code: string; slot: number }>;
  join(code: string, name: string): Promise<{ code: string; slot: number }>; // rejects with ErrorReason
  send(m: ClientToRelay): void; sendBinary(b: Uint8Array): void; leave(): void;
}
export function relayUrl(): string | null;              // import.meta.env.VITE_RELAY_URL || null
export function wakeRelay(url: string, timeoutMs = 75_000): Promise<boolean>; // GET https(s)://…/health, retries every 3 s
```

- **Reconnect:** on an unexpected close after `welcome`, the client sets `status = "reconnecting"` and retries every 1 s for `COOP.reconnectGraceMs`, sending `{t:"rejoin", code, token}`. When the time runs out it sets `"closed"`.
- **Wake URL:** `wakeRelay` maps `wss://` to `https://` and `ws://` to `http://`.

- [ ] **Step 1: Write failing tests.** They start `RoomManager` plus a `ws` server on an ephemeral port in `beforeAll`, and pass `ws`'s `WebSocket` as `socketCtor`:
  - `host then join exchanges a client→host message`
  - `join with unknown code rejects "not_found"`
  - `client reconnects with its token after the socket is killed server-side` (the slot is unchanged and the status returns to "open")
  - `wakeRelay resolves true against /health and false against a closed port within the timeout` (use `timeoutMs: 500`)
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement. Set `binaryType = "arraybuffer"`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(net): relay client with reconnect and wake-up probe`.

### Task 7: Host and client sessions

**Files:**
- Create: `src/net/gameProtocol.ts`, `src/net/hostSession.ts`, `src/net/clientSession.ts`, `test/unit/sessions.test.ts`

**Interfaces:**
- Consumes: Task 3 `World` API, Task 5 snapshot functions, Task 6 `RelayClient` (via the narrow interface below, so tests can fake it).
- Produces:

```ts
// gameProtocol.ts
export type ClientToHost =
  | { k: "pose"; x: number; y: number; facing: number; firing: boolean }
  | { k: "pick"; round: number; index: number } | { k: "ping" };
export type HostToClient =
  | { k: "start"; slots: { slot: number; name: string }[] }
  | { k: "cards"; round: number; cards: UpgradeCard[] }
  | { k: "over"; time: number; kills: number; level: number; perPlayer: { slot: number; name: string; kills: number }[] }
  | { k: "lobby" };
export interface Wire { send(m: ClientToRelay): void; sendBinary(b: Uint8Array): void }

// hostSession.ts
export class HostSession {
  constructor(world: World, wire: Wire, now: () => number = performance.now.bind(performance));
  start(slots: { slot: number; name: string }[]): void;   // world.reset(slots); world.recordEffects = true; sends "start"
  step(dt: number, localInput: PlayerInput): void;          // one fixed tick
  onClientMessage(from: number, m: ClientToHost): void;
  onRoster(players: RosterEntry[]): void;                   // disconnected → idle; missing → world.removePlayer
  pickLocal(index: number): void;
  get huddle(): { round: number; cards: UpgradeCard[]; waiting: number[] } | null; // host's own cards
  readonly overInfo: HostToClient & { k: "over" } | null;
}

// clientSession.ts
export class ClientSession {
  constructor(world: World, wire: Wire, localSlot: number, now?: () => number);
  onHostMessage(m: HostToClient): void;
  onSnapshot(buf: ArrayBuffer): void;
  step(dt: number, localInput: PlayerInput): void;          // prediction + pose send at COOP.poseHz
  frame(rdt: number): void;                                  // interpolate at now − interpDelayMs, replay new effects, world.tickCosmetics
  pick(index: number): void; ping(): void;
  get cards(): { round: number; cards: UpgradeCard[] } | null;
  get waiting(): number[];                                   // from snapshot waitingMask
  get hostPaused(): boolean;                                 // no snapshot for COOP.hostPausedMs while running
  readonly overInfo: (HostToClient & { k: "over" }) | null;
}
```

- **Host huddle:**
  - When `world.pendingLevelUps > 0` and no huddle is open, the host opens round `r+1`. It rolls cards per active player, sends `cards` to each client, and pauses `world.update`. Snapshots keep flowing with `waitingMask`.
  - Picks whose `round` doesn't match are ignored.
  - At `COOP.huddleTimeoutSec` it auto-picks index 0 for every player still waiting.
  - When nobody active is waiting, it calls `world.finishLevelUp()` and closes the huddle. If anything is still pending, the next round opens on the next step.
- **Snapshots:** the host sends one snapshot every `1/COOP.snapshotHz` seconds of sim time, plus one immediately on huddle open and close.
- **Game over:** when `world.gameOver` first becomes true, the host sends `over` once.
- **Client prediction:**
  - The client calls `world.stepPlayerMovement(world.player, localInput, dt)` only while the run is going, the player is not downed and no huddle is active.
  - It sends a `pose` every `1/COOP.poseHz` s.
  - `ping()` sends `{k:"ping"}`. On the host side, `onClientMessage` calls `world.addPing(from)`. The host's own ping calls `world.addPing(0)` directly.

- [ ] **Step 1: Write failing tests** with a fake `Wire` that records frames, a fake `now`, and a loopback that feeds the host's binary frames into `ClientSession.onSnapshot`:
  - `host broadcasts ~20 snapshots per simulated second`
  - `client pose moves the remote player on the host`
  - `huddle pauses the sim and resumes after all active players pick`
  - `huddle auto-picks after 15 s`
  - `huddle completes when a waiting player is removed mid-huddle` (Review Focus 1)
  - `two pending level-ups produce two rounds; a stale round-1 pick during round 2 is ignored` (Review Focus 5)
  - `host sends "over" exactly once when all players are downed`
  - `client applies snapshots and replays effects once each` (a spied `world.applyEffect` call count equals the effects sent)
  - `client reports hostPaused after 1.5 s without snapshots and clears it on the next snapshot` (Review Focus 2)
  - `client prediction is frozen while downed`
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(net): host/client sessions with huddle, prediction, interpolation`.

### Task 8: Rendering and HUD for multiple players

**Files:**
- Modify: `src/render/worldView.ts`, `src/render/camera3d.ts`, `src/ui/hud.ts`, `src/ui/labels3d.ts` (if needed)

**Interfaces:**
- Consumes: `world.players`, `world.localSlot`, `world.pings`, `COOP.slotColors`.
- Produces:
  - `WorldView.sync(world, dt)` draws, for every active player:
    - one robot handle tinted with its slot colour
    - its own orbital meshes (8 per slot)
    - the pickup ring, for the local player only
    - the `Death` clip when downed
    - a revive ring at the player's feet whose arc fills with `reviveT`
    - a name label in `floatLabels`, in the slot colour, above each non-local robot
  - Ping markers: a vertical beam in the slot colour, fading with `life / pingLifeSec`.
  - Enemies face the nearest active player.
  - `FollowCamera` follows `world.player`, which is already the local player.
  - `drawHud`:
    - Teammate rows go under the HP bar: the name in the slot colour, a mini HP bar, and "DOWN" when downed.
    - Edge arrows in the slot colour point to off-screen teammates and pings. Project with `scene3d.camera`, and pass the camera into `drawHud`.
    - In solo, nothing new is drawn.

- [ ] **Step 1:** Implement. No unit tests: this is the render layer, and the Task 10 smoke test covers it.
- [ ] **Step 2:** Run `npm run typecheck && npm run build && npm run smoke`. Expected: PASS.
- [ ] **Step 3: Manual check.** Temporarily set `?debug2p` to reset the World with 2 slots and drive P1 with `IDLE_INPUT`. Two robots should appear with distinct colours and labels. Remove the flag before committing.
- [ ] **Step 4:** Commit: `feat(render): multi-robot view, teammate HUD, edge arrows, pings`.

### Task 9: Title, lobby, join, and main-state wiring

**Files:**
- Create: `src/ui/lobby.ts`, `src/ui/codeInput.ts`
- Modify: `src/ui/screens.ts`, `src/core/input.ts`, `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: Tasks 6–8.
- Produces:
  - `screens.ts`:
    - `titleButtonRects(w, h): { solo: Rect; host: Rect; join: Rect }`. Solo occupies today's PLAY position, so the existing smoke click at (640, 500) still starts solo. Host and Join sit as a row under it.
    - `drawTitle` takes an extra `coop: "ready" | "waking" | "unavailable"`. When the value is not `"ready"`, it draws the Host and Join buttons dimmed with the labels "Waking co-op server…" or "Co-op unavailable".
    - `drawLevelUp(ctx, w, h, cards: UpgradeCard[], pointer, t, waitingNames: string[] = [])`. A non-empty `waitingNames` draws the strip "waiting on BOLT-7…". Solo builds its cards with `toCard`.
  - `lobby.ts`:
    - `drawLobby(ctx, w, h, t, view: { code: string; players: RosterEntry[]; isHost: boolean; error?: string })`, which shows the code, a copy-link button, the slot-coloured roster, and Start (host only, enabled when there are ≥2 players) or "Waiting for host…".
    - `lobbyButtonRects(w, h): { copy: Rect; start: Rect; leave: Rect }`
    - `drawCoopGameOver(...)` shows the team stats plus per-player kills, with "Play again" for the host and "Waiting for host…" for others.
    - `randomCallsign(rand = Math.random): string`, e.g. `BOLT-7`, from a 12-word list.
  - `codeInput.ts`: `askRoomCode(): Promise<string | null>`. It shows a DOM `<input maxlength=4 autocapitalize=characters>` overlay with Join and Cancel, validates with `normalizeCode`, and shows "Codes are 4 letters/numbers" on invalid input. A DOM input is needed so the mobile keyboard opens.
  - `Input`: a ping edge on `KeyG` via the existing `consumeKey("KeyG")`. On touch, a HUD ping button rect is exported from `hud.ts` as `pingButtonRect(w, h)`.
  - `main.ts` states: add `"lobby"`. Store `mode: "solo" | "host" | "client"`.
    - **Title:** on load, if `relayUrl()` is set, call `wakeRelay`, which sets `coop` to waking and then ready or unavailable.
      - With `?room=XXXX`, after the model loads, join directly and strip the param with `history.replaceState`.
    - **Host flow:** Host → `relay.host(callsign)` → lobby → Start, which sends `{t:"start"}` and calls `HostSession.start(roster)` → playing.
      - Each update tick calls `hostSession.step`.
      - The host's level-up uses `hostSession.huddle`.
    - **Client flow:** Join → `askRoomCode` → `relay.join` → lobby. On `{k:"start"}` the client goes to playing.
      - Each update tick calls `clientSession.step`, and each render calls `clientSession.frame`.
      - The level-up state shows `clientSession.cards`.
      - When `hostPaused` is true, it draws a "Host paused" banner.
    - **Pause in co-op:** `Esc` opens a "Leave run" overlay. The sim keeps running. `visibilitychange` does not pause co-op.
    - **Game over in co-op:** `drawCoopGameOver`. The best time is saved to `novaswarm.best.coop`. The host's Play again sends `{t:"lobby"}` and `{k:"lobby"}`, and everyone returns to the lobby.
    - `{t:"closed"}` or a relay status of `"closed"` triggers a toast ("Host left" or "Connection lost") and returns to the title.
    - Join errors are mapped to copy:
      - `not_found`: "No room with that code"
      - `full`: "Room is full (4/4)"
      - `started`: "That run already started"
      - `bad_code`: "Codes are 4 letters/numbers"
  - The `?debug` probe adds `mode`, `players: world.players.filter(p => p.active).length`, `relay: relay?.status`, `code` and `slot`.

- [ ] **Step 1:** Implement the screens and UI helpers, then wire `main.ts`.
- [ ] **Step 2:** Run `npm test && npm run typecheck && npm run build && npm run smoke`. Expected: PASS, with solo unchanged.
- [ ] **Step 3: Manual check.**
  1. Run `npm --prefix server run dev` and `VITE_RELAY_URL=ws://localhost:8787 npm run dev`.
  2. Open two browser windows. Host in one, join from the other with the code, and start.
  3. Both robots should move, a level-up huddle should resolve, a downed player should be revivable, and `G` should place a ping visible in both windows.
- [ ] **Step 4:** Commit: `feat(ui): co-op title, lobby, join flow and session wiring`.

### Task 10: Two-browser smoke test, CI, docs

**Files:**
- Create: `test/coop-smoke.mjs`
- Create: `.github/workflows/ci.yml`. Only `deploy.yml` (GitHub Pages) exists today. Leave it untouched.
- Modify: `package.json` (`"smoke:coop": "node test/coop-smoke.mjs"`), `README.md`

**Interfaces:**
- Consumes: the `?debug` probe fields from Task 9, and `RoomManager` plus the `ws` server.

- [ ] **Step 1: Write `test/coop-smoke.mjs`.**
  - Setup:
    - Start the relay in-process (spawn `npm --prefix server start` with `PORT=8788`, or import the server).
    - Build with `VITE_RELAY_URL=ws://localhost:8788`, then run Vite `preview` on 4188.
    - Use two Playwright browser contexts with the same SwiftShader flags as `smoke.mjs`.
  - The test steps:
    1. A clicks Host. Wait for `__nova().code`.
    2. B opens `?debug&room=<code>`. Both reach `state === "lobby"` with `players === 2` in the roster.
    3. A clicks Start. Both reach `"playing"`.
    4. B holds `d` for 2 s. A's `__nova()` must report B's player moved (add `peers: [{slot, x, y}]` to the probe).
    5. Both press `Digit1` in a loop until each has seen `level > 1`, which proves a huddle resolved.
    6. There are no console errors or page errors in either page.
  - Exit code 1 on failure.
- [ ] **Step 2:** Run `npm run smoke:coop`. Expected: an `OK: …` line and exit code 0.
- [ ] **Step 3: CI.** Create `ci.yml`, triggered on push and pull_request to `main`. It runs on ubuntu-latest with Node 22 and these steps:
  1. `npm ci`
  2. `npm --prefix server ci`
  3. `npm run typecheck`
  4. `npm --prefix server run typecheck`
  5. `npm test`
  6. `npm run build`
- [ ] **Step 4: README.** Add a "Co-op" section covering:
  - how to play: Host, Join, the code, revive, and `G` to ping
  - running locally (two commands)
  - deploying: Render → New → Blueprint → this repo. Then set `VITE_RELAY_URL=wss://<service>.onrender.com` in Vercel project env and redeploy.
  - the free-tier sleep note
- [ ] **Step 5:** Run `npm test && npm run build && npm run smoke && npm run smoke:coop`. Expected: all pass.
- [ ] **Step 6:** Commit: `test: two-browser co-op smoke test; CI + README for co-op`.
