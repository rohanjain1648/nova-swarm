import "./style.css";
import { Audio } from "./core/audio";
import { Input } from "./core/input";
import { GameLoop } from "./core/loop";
import { World, type RunStats } from "./game/world";
import { drawHud } from "./ui/hud";
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
} from "./ui/screens";
import type { Upgrade } from "./game/upgrades";
import { Scene3D } from "./render/scene";
import { FollowCamera } from "./render/camera3d";
import { RobotFactory } from "./render/robots";
import { WorldView } from "./render/worldView";
import { drawFloatLabels } from "./ui/labels3d";

type State = "loading" | "menu" | "playing" | "levelup" | "paused" | "gameover";

const BEST_KEY = "novaswarm.best";
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
let best: RunStats | null = loadBest();
let newBest = false;

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
  })
  .catch((err) => {
    console.error("Failed to load robot model:", err);
  });

// --- Persistence ------------------------------------------------------------
function loadBest(): RunStats | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    return raw ? (JSON.parse(raw) as RunStats) : null;
  } catch {
    return null;
  }
}
function saveBest(s: RunStats): void {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(s));
  } catch {
    /* storage may be unavailable in private mode; scores are non-critical */
  }
}

// --- Transitions ------------------------------------------------------------
function startGame(): void {
  audio.unlock();
  audio.startMusic();
  world.reset();
  newBest = false;
  state = "playing";
}

function openLevelUp(): void {
  choices = world.rollUpgradeChoices();
  state = "levelup";
}

function finishRun(): void {
  const s = world.stats;
  if (!best || s.time > best.time) {
    best = { ...s };
    saveBest(best);
    newBest = true;
  }
  state = "gameover";
}

/** Abandon the current run and return to the title screen (still banks a new best). */
function quitToMenu(): void {
  const s = world.stats;
  if (!best || s.time > best.time) {
    best = { ...s };
    saveBest(best);
  }
  audio.stopMusic();
  state = "menu";
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
  if (input.consumeConfirm()) startGame();
}

function handlePlaying(dt: number): void {
  if (input.consumeKey("KeyM")) audio.toggleMute();
  if (input.consumeKey("Escape") || input.consumeKey("KeyP")) {
    state = "paused";
    input.consumeConfirm();
    return;
  }
  world.update(dt, input);
  if (world.gameOver) finishRun();
  else if (world.pendingLevelUps > 0) openLevelUp();
}

function handleLevelUp(): void {
  if (input.consumeKey("KeyM")) audio.toggleMute();
  let pick = -1;
  const num = input.consumeNumber();
  if (num >= 1 && num <= choices.length) pick = num - 1;

  const click = input.consumeClick();
  if (click) {
    const rects = levelUpLayout(W, H);
    for (let i = 0; i < choices.length; i++) {
      if (pointInRect(click.x, click.y, rects[i])) pick = i;
    }
  }
  input.consumeConfirm(); // don't let a stray confirm leak into gameplay

  if (pick >= 0) {
    world.applyUpgrade(choices[pick]);
    if (world.pendingLevelUps > 0) choices = world.rollUpgradeChoices();
    else state = "playing";
  }
}

function handlePaused(): void {
  if (input.consumeKey("KeyM")) audio.toggleMute();

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
  if (input.consumeConfirm()) startGame();
}

// Auto-pause when the tab loses focus mid-run.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "playing") state = "paused";
});

// --- Loop -------------------------------------------------------------------
function update(dt: number): void {
  switch (state) {
    case "loading": break;
    case "menu": handleMenu(); break;
    case "playing": handlePlaying(dt); break;
    case "levelup": handleLevelUp(); break;
    case "paused": handlePaused(); break;
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

  // Sync the 3D scene from World's data + advance camera/atmosphere on the
  // real render clock (not the fixed sim step) so animation blending stays smooth.
  worldView.sync(world, rdt);
  followCamera.update(world, rdt);
  scene3d.followSun(world.player.x, world.player.y);
  scene3d.updateAtmosphere(rdt, world.player.x, world.player.y);
  scene3d.render();

  drawFloatLabels(hudCtx, worldView.floatLabels, scene3d.camera, W, H);

  if (state === "menu") {
    drawTitle(hudCtx, W, H, t, best, audio.muted);
    return;
  }

  drawHud(hudCtx, world, audio.muted, W, H);
  drawScreenFlash(t);

  if (state === "levelup") {
    drawLevelUp(hudCtx, W, H, world, choices, input.pointerPosition, t);
  } else if (state === "paused") {
    drawPause(hudCtx, W, H, t);
  } else if (state === "gameover") {
    drawGameOver(hudCtx, W, H, world.stats, best, newBest, t);
  }
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
    level: world.level,
    xp: Math.round(world.xp),
    xpToNext: world.xpToNext,
    kills: world.kills,
    hp: Math.round(world.player.hp),
    pending: world.pendingLevelUps,
    time: Math.round(world.time),
  });
}
