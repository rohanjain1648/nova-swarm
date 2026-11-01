import "./style.css";
import { Audio } from "./core/audio";
import { Input } from "./core/input";
import { GameLoop } from "./core/loop";
import { IDLE_INPUT, type PlayerInput } from "./game/types";
import { World, type RunStats } from "./game/world";
import { drawHud, pingButtonRect } from "./ui/hud";
import {
  drawGameOver,
  drawLevelUp,
  drawPause,
  drawTitle,
  levelUpLayout,
  muteButtonRect,
  pointInRect,
  quitButtonRect,
  resumeButtonRect,
  titleButtonRects,
  type CoopAvailability,
} from "./ui/screens";
import { toCard, type Upgrade, type UpgradeCard } from "./game/upgrades";
import { Scene3D } from "./render/scene";
import { FollowCamera } from "./render/camera3d";
import { RobotFactory } from "./render/robots";
import { WorldView } from "./render/worldView";
import { drawFloatLabels } from "./ui/labels3d";
import {
  coopGameOverRects,
  drawBanner,
  drawCoopGameOver,
  drawCoopMenu,
  drawHuddleWait,
  drawLobby,
  lobbyButtonRects,
  randomCallsign,
} from "./ui/lobby";
import { askRoomCode } from "./ui/codeInput";
import { RelayClient, relayUrl, wakeRelay } from "./net/relayClient";
import { HostSession } from "./net/hostSession";
import { ClientSession } from "./net/clientSession";
import type { ClientToHost, HostToClient, OverInfo } from "./net/gameProtocol";
import type { ErrorReason, RelayToClient, RosterEntry } from "./net/relayProtocol";

type State = "loading" | "menu" | "lobby" | "playing" | "levelup" | "paused" | "gameover";
type Mode = "solo" | "host" | "client";

const BEST_KEY = "novaswarm.best";
const COOP_BEST_KEY = "novaswarm.best.coop";
const PLAYER_MODEL_HEIGHT = 110; // desired rendered height (game units) of the player robot

const app = document.getElementById("app") as HTMLDivElement;
const sceneCanvas = document.getElementById("scene") as HTMLCanvasElement;
const hudCanvas = document.getElementById("hud") as HTMLCanvasElement;
const hudCtx = hudCanvas.getContext("2d")!;

const audio = new Audio();
const input = new Input(app);

let W = window.innerWidth;
let H = window.innerHeight;

const scene3d = new Scene3D(sceneCanvas);
const world = new World(audio);
const followCamera = new FollowCamera(scene3d.camera);
world.setViewRadius(followCamera.viewRadius);

const robotFactory = new RobotFactory();
let worldView: WorldView | null = null;

let state: State = "loading";
let loadFrac = 0;
let choices: Upgrade[] = [];
let best: RunStats | null = loadBest(BEST_KEY);
let coopBest: RunStats | null = loadBest(COOP_BEST_KEY);
let newBest = false;

// --- Co-op session state ------------------------------------------------------
let mode: Mode = "solo";
const RELAY_URL = relayUrl();
let coop: CoopAvailability = RELAY_URL ? "waking" : "unavailable";
let relay: RelayClient | null = null;
let hostSession: HostSession | null = null;
let clientSession: ClientSession | null = null;
let roster: RosterEntry[] = [];
const callsign = randomCallsign();
let toast: { text: string; until: number } | null = null;
let joining = false;

if (RELAY_URL) {
  void wakeRelay(RELAY_URL).then((ok) => {
    coop = ok ? "ready" : "unavailable";
  });
}

// --- Canvas sizing (DPR-aware HUD; the WebGL canvas is managed by Scene3D) -
function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  hudCanvas.width = Math.floor(W * dpr);
  hudCanvas.height = Math.floor(H * dpr);
  hudCanvas.style.width = `${W}px`;
  hudCanvas.style.height = `${H}px`;
  hudCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scene3d.resize(W, H);
}
window.addEventListener("resize", resize);
resize();

robotFactory
  .load(`${import.meta.env.BASE_URL}models/RobotExpressive.glb`, (f) => {
    loadFrac = f;
  })
  .then(() => {
    worldView = new WorldView(scene3d.scene, robotFactory);
    worldView.calibrateScale(PLAYER_MODEL_HEIGHT);
    state = "menu";
    // Invite link: ?room=ABCD joins straight away (and the param is stripped
    // so a refresh doesn't re-join a room that has moved on).
    const params = new URLSearchParams(location.search);
    const code = params.get("room");
    if (code) {
      params.delete("room");
      const qs = params.toString();
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
      joinRoom(code);
    }
  })
  .catch((err) => {
    console.error("Failed to load robot model:", err);
  });

// --- Persistence ------------------------------------------------------------
function loadBest(key: string): RunStats | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as RunStats) : null;
  } catch {
    return null;
  }
}
function saveBest(key: string, s: RunStats): void {
  try {
    localStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* storage may be unavailable in private mode; scores are non-critical */
  }
}

function showToast(text: string, ms = 3500): void {
  toast = { text, until: performance.now() + ms };
}

// --- Transitions ------------------------------------------------------------
/** Shared run start for solo and co-op (the World itself is reset by the caller/session). */
function enterRun(): void {
  audio.unlock();
  audio.startMusic();
  newBest = false;
  state = "playing";
  // Push a history entry so the mobile back button/gesture has something to
  // "consume" — without this, Android back navigates straight off the page
  // mid-run instead of pausing (see the popstate handler below).
  history.pushState({ novaGame: true }, "", location.href);
}

function startGame(): void {
  world.localSlot = 0;
  world.recordEffects = false;
  world.reset();
  enterRun();
}

function openLevelUp(): void {
  choices = world.rollUpgradeChoices();
  state = "levelup";
}

function finishRun(): void {
  const s = world.stats;
  if (!best || s.time > best.time) {
    best = { ...s };
    saveBest(BEST_KEY, best);
    newBest = true;
  }
  state = "gameover";
}

/** Abandon the current run and return to the title screen (still banks a new best). */
function quitToMenu(): void {
  const s = world.stats;
  if (!best || s.time > best.time) {
    best = { ...s };
    saveBest(BEST_KEY, best);
  }
  audio.stopMusic();
  state = "menu";
}

// --- Co-op transitions --------------------------------------------------------
const JOIN_ERRORS: Record<ErrorReason | "unreachable", string> = {
  not_found: "No room with that code",
  full: "Room is full (4/4)",
  started: "That run already started",
  bad_code: "Codes are 4 letters/numbers",
  bad_token: "Couldn't rejoin that room",
  unreachable: "Couldn't reach the co-op server",
};

function newRelay(): RelayClient {
  const r = new RelayClient(RELAY_URL!);
  r.onMessage = (m) => {
    if (r === relay) onRelayMessage(m);
  };
  r.onBinary = (b) => {
    if (r === relay) clientSession?.onSnapshot(b);
  };
  r.onStatus = (s) => {
    if (r !== relay) return;
    if (s === "closed") leaveCoop("Connection lost");
    else if (s === "reconnecting") showToast("Reconnecting…", 2000);
  };
  return r;
}

function hostRoom(): void {
  if (!RELAY_URL || coop !== "ready" || joining) return;
  audio.unlock();
  joining = true;
  relay = newRelay();
  relay
    .host(callsign)
    .then(() => {
      mode = "host";
      hostSession = new HostSession(world, relay!);
      state = "lobby";
    })
    .catch((reason: ErrorReason | "unreachable") => {
      relay = null;
      showToast(JOIN_ERRORS[reason] ?? "Couldn't host a room");
    })
    .finally(() => {
      joining = false;
    });
}

function joinRoom(code: string): void {
  if (!RELAY_URL || joining) {
    if (!RELAY_URL) showToast("Co-op unavailable");
    return;
  }
  audio.unlock();
  joining = true;
  relay = newRelay();
  relay
    .join(code, callsign)
    .then(({ slot }) => {
      mode = "client";
      clientSession = new ClientSession(world, relay!, slot);
      state = "lobby";
    })
    .catch((reason: ErrorReason | "unreachable") => {
      relay = null;
      showToast(JOIN_ERRORS[reason] ?? "Couldn't join");
    })
    .finally(() => {
      joining = false;
    });
}

/** Drop out of co-op entirely and go back to the title. */
function leaveCoop(reason?: string): void {
  const r = relay;
  relay = null;
  r?.leave();
  hostSession = null;
  clientSession = null;
  roster = [];
  mode = "solo";
  world.localSlot = 0;
  world.recordEffects = false;
  world.reset();
  audio.stopMusic();
  state = "menu";
  if (reason) showToast(reason);
}

function onRelayMessage(m: RelayToClient): void {
  if (m.t === "roster") {
    roster = m.players;
    if (hostSession && state !== "lobby") hostSession.onRoster(m.players);
  } else if (m.t === "closed") {
    leaveCoop("Host left the room");
  } else if (m.t === "msg") {
    if (mode === "host") hostSession?.onClientMessage(m.from, m.data as ClientToHost);
    else if (mode === "client") onHostMessage(m.data as HostToClient);
  }
}

function onHostMessage(m: HostToClient): void {
  if (!clientSession) return;
  clientSession.onHostMessage(m);
  if (m.k === "start") enterRun();
  else if (m.k === "lobby") {
    audio.stopMusic();
    state = "lobby";
  }
}

function startCoopRun(): void {
  if (!hostSession || !relay) return;
  const slots = roster.filter((p) => p.connected).map((p) => ({ slot: p.slot, name: p.name }));
  if (slots.length < 2) return;
  relay.send({ t: "start" });
  hostSession.start(slots);
  enterRun();
}

function finishCoopRun(info: OverInfo): void {
  const s: RunStats = { time: info.time, kills: info.kills, level: info.level };
  newBest = false;
  if (!coopBest || s.time > coopBest.time) {
    coopBest = s;
    saveBest(COOP_BEST_KEY, s);
    newBest = true;
  }
  state = "gameover";
}

function copyInvite(): void {
  if (!relay) return;
  const link = `${location.origin}${location.pathname}?room=${relay.code}`;
  navigator.clipboard?.writeText(link).then(
    () => showToast("Invite link copied", 2000),
    () => showToast(link, 6000),
  );
}

// --- Per-state input handling (runs on the fixed update tick) ---------------
function handleMenu(): void {
  if (input.consumeKey("KeyM")) {
    audio.unlock();
    audio.toggleMute();
  }
  const click = input.consumeClick();
  if (click && pointInRect(click.x, click.y, muteButtonRect(W))) {
    audio.unlock();
    audio.toggleMute();
    input.consumeConfirm();
    return;
  }
  if (click && coop === "ready") {
    const r = titleButtonRects(W, H);
    if (pointInRect(click.x, click.y, r.host)) {
      input.consumeConfirm();
      hostRoom();
      return;
    }
    if (pointInRect(click.x, click.y, r.join)) {
      input.consumeConfirm();
      void askRoomCode().then((code) => code && joinRoom(code));
      return;
    }
  }
  if (joining) {
    input.consumeConfirm();
    return;
  }
  if (input.consumeConfirm()) startGame();
}

function handleLobby(): void {
  if (input.consumeKey("KeyM")) audio.toggleMute();
  input.consumeConfirm();
  const click = input.consumeClick();
  if (!click) return;
  const r = lobbyButtonRects(W, H);
  if (pointInRect(click.x, click.y, r.copy)) copyInvite();
  else if (pointInRect(click.x, click.y, r.leave)) leaveCoop();
  else if (mode === "host" && pointInRect(click.x, click.y, r.start)) startCoopRun();
}

function handlePlaying(dt: number): void {
  if (input.consumeKey("KeyM")) audio.toggleMute();
  if (input.consumeKey("Escape") || input.consumeKey("KeyP")) {
    state = "paused";
    input.consumeConfirm();
    return;
  }
  if (mode !== "solo") {
    stepCoop(dt, input.read());
    return;
  }
  world.update(dt, [input.read()]);
  if (world.gameOver) finishRun();
  else if (world.pendingLevelUps > 0) openLevelUp();
}

/** One co-op tick in any in-run state; `inp` is idle while a menu covers the screen. */
function stepCoop(dt: number, inp: PlayerInput): void {
  if (state === "playing") {
    const click = input.consumeClick();
    const pinged = input.consumeKey("KeyG") || (click && pointInRect(click.x, click.y, pingButtonRect(W, H)));
    if (pinged) {
      if (mode === "host") world.addPing(0);
      else clientSession?.ping();
    }
  }
  if (mode === "host" && hostSession) {
    hostSession.step(dt, inp);
    if (hostSession.overInfo && state !== "gameover") finishCoopRun(hostSession.overInfo);
    else if (state === "playing" && (hostSession.huddle?.cards.length ?? 0) > 0) state = "levelup";
  } else if (mode === "client" && clientSession) {
    clientSession.step(dt, inp);
    if (clientSession.overInfo && state !== "gameover") finishCoopRun(clientSession.overInfo);
    else if (state === "playing" && clientSession.cards) state = "levelup";
  }
}

/** The cards this player is choosing from right now. */
function currentCards(): UpgradeCard[] {
  if (mode === "host") return hostSession?.huddle?.cards ?? [];
  if (mode === "client") return clientSession?.cards?.cards ?? [];
  return choices.map((u) => toCard(u, world.player));
}

/** Names of teammates still picking in the open huddle (never yourself). */
function waitingNames(): string[] {
  const slots = mode === "host" ? hostSession?.huddle?.waiting ?? [] : clientSession?.waiting ?? [];
  return slots.filter((s) => s !== world.localSlot).map((s) => world.players[s]?.name ?? "?");
}

function handleLevelUp(dt: number): void {
  if (input.consumeKey("KeyM")) audio.toggleMute();
  const cards = currentCards();
  let pick = -1;
  const num = input.consumeNumber();
  if (num >= 1 && num <= cards.length) pick = num - 1;

  const click = input.consumeClick();
  if (click) {
    const rects = levelUpLayout(W, H);
    for (let i = 0; i < cards.length; i++) {
      if (pointInRect(click.x, click.y, rects[i])) pick = i;
    }
  }
  input.consumeConfirm(); // don't let a stray confirm leak into gameplay

  if (mode !== "solo") {
    if (pick >= 0) {
      if (mode === "host") hostSession?.pickLocal(pick);
      else clientSession?.pick(pick);
    }
    stepCoop(dt, IDLE_INPUT);
    // Picked (or auto-picked by the host's timer): back to the run view, which
    // shows the "waiting on…" overlay until the whole squad has chosen.
    if (state === "levelup" && currentCards().length === 0) state = "playing";
    return;
  }

  if (pick >= 0) {
    world.applyUpgrade(0, choices[pick]);
    world.finishLevelUp();
    if (world.pendingLevelUps > 0) choices = world.rollUpgradeChoices();
    else state = "playing";
  }
}

function handlePaused(dt: number): void {
  if (input.consumeKey("KeyM")) audio.toggleMute();

  if (mode !== "solo") {
    // Co-op menu: the run keeps going underneath with our robot idle.
    stepCoop(dt, IDLE_INPUT);
    if (state !== "paused") return;
    if (input.consumeKey("Escape") || input.consumeKey("KeyP")) {
      input.consumeConfirm();
      state = "playing";
      return;
    }
    const click = input.consumeClick();
    input.consumeConfirm();
    if (click) {
      if (pointInRect(click.x, click.y, resumeButtonRect(W, H))) state = "playing";
      else if (pointInRect(click.x, click.y, quitButtonRect(W, H))) leaveCoop();
    }
    return;
  }

  if (input.consumeKey("KeyQ")) {
    input.consumeConfirm();
    quitToMenu();
    return;
  }
  if (input.consumeKey("Escape") || input.consumeKey("KeyP") || input.consumeKey("Space") || input.consumeKey("Enter")) {
    input.consumeConfirm();
    state = "playing";
    return;
  }

  const click = input.consumeClick();
  if (click) {
    input.consumeConfirm();
    if (pointInRect(click.x, click.y, resumeButtonRect(W, H))) state = "playing";
    else if (pointInRect(click.x, click.y, quitButtonRect(W, H))) quitToMenu();
  }
}

function handleGameOver(): void {
  if (input.consumeKey("KeyM")) audio.toggleMute();
  if (mode !== "solo") {
    input.consumeConfirm();
    const click = input.consumeClick();
    if (!click) return;
    const r = coopGameOverRects(W, H);
    if (pointInRect(click.x, click.y, r.leave)) leaveCoop();
    else if (mode === "host" && pointInRect(click.x, click.y, r.again)) {
      hostSession?.backToLobby();
      audio.stopMusic();
      state = "lobby";
    }
    return;
  }
  if (input.consumeConfirm()) startGame();
}

// Auto-pause when the tab loses focus mid-run (solo only — a co-op run can't
// stop for one player).
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "playing" && mode === "solo") state = "paused";
});

// Mobile back button/gesture: pause instead of leaving the page (Android
// Chrome maps back to browser history navigation by default, which would
// otherwise exit the run entirely). Re-push the guard entry each time so
// every subsequent back-press while the game is active is caught the same
// way; once the player is back on the menu we stop re-pushing, so back
// behaves normally (actually leaves) when there's no run to protect.
window.addEventListener("popstate", () => {
  if (state === "playing") state = "paused";
  if (state !== "menu" && state !== "loading") {
    history.pushState({ novaGame: true }, "", location.href);
  }
});

// --- Loop -------------------------------------------------------------------
function update(dt: number): void {
  switch (state) {
    case "loading": break;
    case "menu": handleMenu(); break;
    case "lobby": handleLobby(); break;
    case "playing": handlePlaying(dt); break;
    case "levelup": handleLevelUp(dt); break;
    case "paused": handlePaused(dt); break;
    case "gameover": handleGameOver(); break;
  }
}

let lastRenderT = performance.now();

function render(): void {
  const now = performance.now();
  const rdt = Math.min(0.05, (now - lastRenderT) / 1000);
  lastRenderT = now;
  const t = now / 1000;

  hudCtx.clearRect(0, 0, W, H);

  if (state === "loading" || !worldView) {
    scene3d.render();
    drawLoading(t);
    return;
  }

  // A co-op client's World is written from host snapshots, once per frame.
  if (mode === "client" && clientSession?.isRunning) clientSession.frame(rdt);

  // Sync the 3D scene from World's data + advance camera/atmosphere on the
  // real render clock (not the fixed sim step) so animation blending stays smooth.
  worldView.sync(world, rdt);
  followCamera.update(world, rdt);
  scene3d.followSun(world.player.x, world.player.y);
  scene3d.updateAtmosphere(rdt, world.player.x, world.player.y);
  scene3d.render();

  drawFloatLabels(hudCtx, worldView.floatLabels, scene3d.camera, W, H);

  if (state === "menu") {
    drawTitle(hudCtx, W, H, t, best, audio.muted, joining ? "waking" : coop);
    drawToast();
    return;
  }
  if (state === "lobby") {
    drawLobby(hudCtx, W, H, t, { code: relay?.code ?? "", players: roster, isHost: mode === "host" });
    drawToast();
    return;
  }

  drawHud(hudCtx, world, audio.muted, W, H, scene3d.camera);
  drawScreenFlash(t);

  const huddleNames = mode === "solo" ? [] : waitingNames();
  if (state === "levelup") {
    drawLevelUp(hudCtx, W, H, currentCards(), input.pointerPosition, t, huddleNames);
  } else if (state === "paused") {
    if (mode === "solo") drawPause(hudCtx, W, H, t);
    else drawCoopMenu(hudCtx, W, H, t);
  } else if (state === "gameover") {
    const info = hostSession?.overInfo ?? clientSession?.overInfo;
    if (mode !== "solo" && info) drawCoopGameOver(hudCtx, W, H, t, info, mode === "host", coopBest, newBest);
    else drawGameOver(hudCtx, W, H, world.stats, best, newBest, t);
  } else if (state === "playing" && huddleNames.length > 0) {
    drawHuddleWait(hudCtx, W, H, huddleNames);
  }

  if (mode === "client" && clientSession?.hostPaused) drawBanner(hudCtx, W, "Host paused — waiting for the host's game…");
  drawToast();
}

function drawToast(): void {
  if (toast && performance.now() < toast.until) drawBanner(hudCtx, W, toast.text, "#eafcff");
}

function drawScreenFlash(t: number): void {
  void t;
  if (world.flashT > 0) {
    hudCtx.fillStyle = `rgba(${world.flashColor},${world.flashT * 0.5})`;
    hudCtx.fillRect(0, 0, W, H);
  }
  const hpFrac = world.player.hp / world.player.maxHp;
  if (hpFrac < 0.35 && !world.gameOver) {
    const pulse = 0.25 + Math.sin(world.time * 6) * 0.1;
    const g = hudCtx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, "rgba(255,0,50,0)");
    g.addColorStop(1, `rgba(255,0,50,${(0.35 - hpFrac) * pulse * 2})`);
    hudCtx.fillStyle = g;
    hudCtx.fillRect(0, 0, W, H);
  }
}

function drawLoading(t: number): void {
  hudCtx.fillStyle = "rgba(3,4,8,0.4)";
  hudCtx.fillRect(0, 0, W, H);
  hudCtx.textAlign = "center";
  hudCtx.textBaseline = "middle";
  hudCtx.fillStyle = "#eafcff";
  hudCtx.font = "900 32px 'Segoe UI', system-ui, sans-serif";
  const pulse = 0.6 + Math.sin(t * 3) * 0.4;
  hudCtx.globalAlpha = 0.7 + pulse * 0.3;
  hudCtx.fillText("BOOTING ROBOTS…", W / 2, H / 2 - 20);
  hudCtx.globalAlpha = 1;

  const bw = Math.min(280, W * 0.6);
  const bx = W / 2 - bw / 2;
  const by = H / 2 + 16;
  hudCtx.fillStyle = "rgba(255,255,255,0.1)";
  hudCtx.fillRect(bx, by, bw, 8);
  hudCtx.fillStyle = "#3fe9ff";
  hudCtx.fillRect(bx, by, bw * Math.max(0.04, loadFrac), 8);
}

const loop = new GameLoop(update, render, 60);
loop.start();

// Opt-in, read-only debug probe for automated smoke tests (append ?debug to the
// URL). Harmless in normal play.
if (new URLSearchParams(location.search).has("debug")) {
  (window as unknown as { __nova: () => unknown }).__nova = () => ({
    state,
    mode,
    coop,
    relay: relay?.status ?? null,
    code: relay?.code ?? null,
    slot: world.localSlot,
    roster: roster.length,
    players: world.players.filter((p) => p.active).length,
    peers: world.players
      .filter((p) => p.active && p.slot !== world.localSlot)
      .map((p) => ({ slot: p.slot, x: Math.round(p.x), y: Math.round(p.y) })),
    level: world.level,
    xp: Math.round(world.xp),
    xpToNext: world.xpToNext,
    kills: world.kills,
    hp: Math.round(world.player.hp),
    pending: world.pendingLevelUps,
    time: Math.round(world.time),
    facingDeg: Math.round((world.player.facing * 180) / Math.PI),
    px: Math.round(world.player.x),
    py: Math.round(world.player.y),
    liveBullets: world.bullets.reduce((n, b) => n + (b.dead ? 0 : 1), 0),
    ui: { title: titleButtonRects(W, H), lobby: lobbyButtonRects(W, H), coopOver: coopGameOverRects(W, H) },
  });
}
