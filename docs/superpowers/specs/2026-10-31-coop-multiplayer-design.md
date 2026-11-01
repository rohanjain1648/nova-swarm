# NOVA SWARM — Co-op Multiplayer Design

Date: 2026-10-31
Status: draft, awaiting approval

## Intent

NOVA SWARM is a solo game today. This feature lets friends play one run
together: 2–4 players in the same arena, against one swarm, from desktop or
mobile web, with no accounts. The point is playing *together*, so the
feature should create moments where players help each other. Two parts do
that: a teammate can revive you, and the team shares XP. Being in the same
arena is not enough on its own.

Success: two friends on different networks can open the live site, one
taps **Host Co-op**, sends a link, the other taps it, and within a minute
they are fighting the same swarm. Their own robot feels as responsive as
in solo play.

## Goals

- 2–4 player co-op run, joined by a 4-letter room code or an invite link
  (`?room=ABCD`).
- Shared arena, shared swarm, shared team XP and team level.
- Each player picks their own upgrades. Builds are personal.
- Downed → revive: a player at 0 HP goes down instead of dying, and a
  teammate can bring them back. The run ends only when everyone is down.
- One ping that every player can place, so players can say "here" with no
  voice chat.
- Solo play stays exactly as it is.

## Non-goals (v1)

- Joining a run that has already started (lobby only; see *Reconnect* for
  the one exception).
- Host migration. If the host leaves, the run ends for everyone.
- Matchmaking or public lobbies. You only play with people you send a code.
- Text or voice chat.
- The Capacitor app in `nova-mobile/`. It has its own copy of `src/`. Port
  co-op to it later, after the web version is proven.
- Anti-cheat. You only play with friends.
- Online leaderboards.

## Anti-goals (failure even if it "works")

- Solo play gets slower, harder, or different in any way.
- Your own robot lags or rubber-bands. Moving must feel the same as solo.
- Players can't tell the robots apart, or can't find each other.
- Joining takes more than code-or-link → lobby → start.
- The live Vercel deploy breaks when the relay server is down. Solo must
  still work.

## Decisions

### Shape of a co-op run

- **Lobby.** The title screen gets three options: **Solo**, **Host Co-op**,
  **Join** (enter a code). The host's lobby shows the room code, a
  copy-link button, and the joined players. Only the host can **Start**. Max
  4 players.
- **Names and colours.** Each player gets an auto-generated callsign (for
  example `BOLT-7`) and a fixed slot colour: P1 keeps today's player cyan,
  then three more colours that are clearly different and are not used by
  any enemy. A small name label floats above each robot.
- **Camera.** It follows *your* robot. Teammates off-screen get an edge
  arrow in their colour.
- **Team XP.** Any player can collect gems. The XP goes into one team pool
  with one team level.
- **Level-up huddle.** When the team levels up, the sim pauses for
  everyone. Each player sees their own 3 cards, rolled from *their* build.
  The game resumes when everyone has picked. A 15 s timer auto-picks for
  anyone who is AFK. Each player's card shows a "waiting on BOLT-7…" strip.
  Downed players still pick.
- **Downed / revive.** At 0 HP a player is *downed*: they can't move or
  fire, and enemies ignore them. A living teammate who stands within revive
  range for 3 s revives them at 30% HP. A ring fills to show progress. If
  every player is downed at the same time, the run ends.
- **Difficulty scales with player count.** The spawn rate and enemy HP get
  multipliers per extra player. Starting values: spawn ×(1 + 0.6·(n−1)) and
  HP ×(1 + 0.3·(n−1)). These are tuning numbers, not fixed rules.
- **Enemies** chase the nearest *living* player. Ranged enemies shoot at
  that player.
- **Spawns** use a ring around a randomly chosen living player each spawn
  tick, so a player who wanders off still gets pressure.
- **Ping.** Press `G`, or tap a HUD ping button on touch. This drops a
  marker in your colour at your robot's position. All players see it for
  4 s, with an edge arrow if it is off-screen. Limit: 1 ping per player
  every 2 s.
- **Pause.** In co-op, `Esc` opens a *Leave run* overlay. It does **not**
  pause the sim.
- **Game over** shows the team stats (time, kills, level) and each
  player's kills. The host's **Play again** returns everyone to the lobby.
  The co-op best time is saved under a separate key
  (`novaswarm.best.coop`), so it never overwrites the solo best.

### Networking model

- **The host is authoritative for everything except each player's own
  movement.** The host's browser runs the real `World` for all players:
  enemies, bullets, damage, XP, level-ups, revives, the director. Clients
  do not simulate combat.
- **Each client is authoritative for its own position and facing.** A
  client moves its own robot locally with the same movement code as solo,
  so moving has zero latency. It sends `{x, y, facing, firing}` to the host
  ~30×/s. The host accepts this, with a sanity clamp on the maximum
  distance moved per tick. This is the decision that keeps "your robot
  feels like solo" (see Anti-goals).
- **Snapshots.** The host sends world snapshots ~20×/s. Each snapshot
  holds: the live enemies, both bullet types, gems, all players, team
  XP/level, run time, the boss HP fraction, the live pings, and a list of
  *events* since the last snapshot (kill, hit, crit text, pickup, hurt,
  level-up, boss warning, nova pulse, revive, down). Clients interpolate
  the entities between the last two snapshots.
- **Effects are cosmetic and stay local.** Clients do not receive
  particles, screen shake, flashes or audio. Each client creates them from
  the events, so every client still gets the full game feel.
- **Bandwidth budget.** At most ~50 KB/s down per client with 300 live
  enemies. That means snapshots should be binary, with quantized
  positions. JSON is fine for the low-rate control messages (lobby, picks,
  pings).
- **The host's tab must stay in the foreground.** The browser throttles
  `requestAnimationFrame` in a background tab, which would stall the sim.
  If the host's tab is hidden, clients show "Host paused". This is
  accepted for v1.

### Relay server

- **A tiny Node.js WebSocket relay** (TypeScript, using the `ws` package)
  in a new `server/` folder with its own `package.json`. It runs as a
  single Render web service, deployed separately from the Vercel static
  site from a `render.yaml` blueprint at the repo root. The rooms live in
  memory in that one process. No database is needed, because a room only
  lasts as long as its run. The relay only does room bookkeeping and
  forwards messages:
  - create a room with a random 4-letter code (no `O/0/I/1`)
  - admit up to 4 players
  - forward client → host and host → all clients
  - tell everyone when someone joins or leaves
  - close the room when the host leaves

  No game logic runs on the server.
- **Why a relay and not peer-to-peer WebRTC:** a relay connects through
  every home or mobile network. Direct P2P fails behind some NATs unless
  you also run a TURN server. P2P can come later as an optimisation.
- **The relay also serves `GET /health`.** Render uses it for health
  checks, and the client uses it to wake the server (see below).
- **Render free tier spin-down.** A free Render web service sleeps after
  about 15 minutes with no traffic and takes roughly a minute to wake.
  - The client sends a `/health` request when the title screen loads, so
    the server is usually awake by the time someone taps Host or Join.
  - While the server is waking, the Host and Join buttons show "Waking
    co-op server…".
  - Upgrading the Render service to a paid instance removes the sleep. That
    change is a setting on Render. No code changes.
- **The client finds the relay** from `VITE_RELAY_URL` (a `wss://` URL) at
  build time.
  - If it is unset, or the relay can't be reached, the co-op buttons show
    "Co-op unavailable" and Solo still works.
  - For local dev, `npm run dev` in `server/` runs the relay on
    `ws://localhost:8787`, next to the game's `npm run dev`.
- **Reconnect.** Each player gets a session token when they join. If a
  client's socket drops, it retries for up to 10 s with that token and gets
  its slot back. During that time its robot stands still. After 10 s the
  host removes the player.

### Code shape

These are guidance calls. The builder may adjust them if the code argues
otherwise.

- `World` goes from one `player` to `players: Player[]`, plus an
  `alive`/`downed` state and a revive timer per player.
  - Solo is simply `players.length === 1`, so the solo code path stays the
    same simulation.
  - Keep a `localPlayer` accessor for the HUD, camera, and level-up screen.
  - Every place that reads `this.player` today needs per-player handling:
    weapons fire per player, contact damage and pickups check each player,
    enemies target the nearest living player, and knockback is computed from
    the shooter.
  - `taken` (the upgrade counts) moves from `World` onto each player.
- **Clients still use a `World` for drawing.** A client holds a `World`
  instance that it never `update()`s. Snapshots are written into its pools,
  so `WorldView`, the HUD and the camera work almost unchanged.
- **Separating input from the sim.** `World.update` takes a per-player
  input struct, not the live `Input` object. Today it calls
  `input.update()` itself. On the host, remote players' structs come from
  the network.
- **Rendering.** `WorldView` gets one robot handle per player slot, tinted
  in the slot colour, plus the downed pose (reuse the existing `Death`
  clip), the revive ring, the name labels, and the ping markers.
- **New modules:**
  - `src/net/` holds the client-side transport, the protocol encode/decode,
    and the host/client session logic.
  - `server/` holds the relay.
  - The message types live in one shared file that both the client and the
    relay import, so the two sides can't drift apart.
- **`main.ts` states** gain `lobby`, plus a co-op variant of `levelup` that
  shows the waiting strip.

## Testing

- The existing `npm run smoke` keeps passing unchanged. It is the guard
  that solo play has not changed.
- A new two-browser Playwright smoke test against a locally started
  relay:
  1. Host creates a room. A second browser context joins with the code.
  2. Both see 2 players in the lobby. The host starts.
  3. Both reach `playing`, and each sees the other's robot moving.
  4. A level-up huddle resolves.
  5. No console errors.

  Extend the `?debug` probe to report the net state and player count.
- A unit-level check that a protocol snapshot round-trips (encode → decode
  gives the same data, within the quantization error).

## Left to the builder

- The exact binary snapshot layout, and the quantization.
- The slot colours (they must be distinct from enemy tints), the revive
  range, the timings, and the difficulty multipliers.
- The callsign word list.
- The interpolation buffer length.
- Whether players can edit their callsign in the lobby (nice to have).
