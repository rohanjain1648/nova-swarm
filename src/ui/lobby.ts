/**
 * Co-op screens drawn on the HUD canvas: the lobby, the co-op game-over card,
 * the in-run co-op menu, plus small banners. Same visual language as
 * screens.ts (neon titles, outlined buttons, dimmed backdrop).
 */
import { COOP, PALETTE } from "../game/config";
import type { RunStats } from "../game/world";
import type { OverInfo } from "../net/gameProtocol";
import type { RosterEntry } from "../net/relayProtocol";
import { formatTime } from "./hud";
import { dim, drawButton, neonTitle, primaryButtonRect, quitButtonRect, resumeButtonRect, roundRect, type Rect } from "./screens";

const FONT = "'Segoe UI', system-ui, sans-serif";

export interface LobbyView {
  code: string;
  players: RosterEntry[];
  isHost: boolean;
}

/** Landscape phones are too short to stack the code, roster and buttons. */
const isShort = (h: number): boolean => h < 520;

export function lobbyButtonRects(w: number, h: number): { copy: Rect; start: Rect; leave: Rect } {
  if (isShort(h)) {
    const bw = Math.min(240, w * 0.4);
    const x = w * 0.27 - bw / 2;
    return {
      copy: { x, y: h * 0.42, w: bw, h: 40 },
      start: { x, y: h * 0.42 + 50, w: bw, h: 48 },
      leave: { x, y: h * 0.42 + 106, w: bw, h: 40 },
    };
  }
  const bw = Math.min(280, w * 0.7);
  const x = w / 2 - bw / 2;
  return {
    copy: { x: w / 2 - 90, y: h * 0.3 + 34, w: 180, h: 36 },
    start: { x, y: h * 0.72, w: bw, h: 56 },
    leave: { x, y: h * 0.72 + 68, w: bw, h: 44 },
  };
}

export function drawLobby(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, view: LobbyView): void {
  dim(ctx, w, h, 0.7);
  const short = isShort(h);
  // On a short screen the code and buttons sit left, the roster right.
  const codeX = short ? w * 0.27 : w / 2;
  neonTitle(ctx, "CO-OP LOBBY", w / 2, h * 0.1, Math.min(short ? 28 : 44, w * 0.08), time, w * 0.9);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(230,244,255,0.6)";
  ctx.font = `600 ${short ? 12 : 14}px ${FONT}`;
  ctx.fillText("ROOM CODE", codeX, h * (short ? 0.2 : 0.2));
  ctx.fillStyle = "#eafcff";
  ctx.font = `900 ${short ? 36 : Math.min(56, w * 0.13)}px ${FONT}`;
  ctx.fillText(view.code.split("").join(" "), codeX, h * (short ? 0.31 : 0.26));

  const r = lobbyButtonRects(w, h);
  drawButton(ctx, r.copy, "COPY INVITE LINK", time, PALETTE.player, 13);

  // Roster: one row per slot, in that slot's colour.
  const rowW = short ? Math.min(320, w * 0.42) : Math.min(360, w * 0.8);
  const rowX = short ? w * 0.73 : w / 2;
  for (let slot = 0; slot < COOP.maxPlayers; slot++) {
    const y = h * (short ? 0.3 : 0.42) + slot * (short ? 44 : 40);
    const entry = view.players.find((p) => p.slot === slot);
    ctx.globalAlpha = entry ? 1 : 0.35;
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    roundRect(ctx, rowX - rowW / 2, y - 16, rowW, 32, 8);
    ctx.fill();
    ctx.fillStyle = COOP.slotColors[slot];
    ctx.beginPath();
    ctx.arc(rowX - rowW / 2 + 20, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.font = `800 15px ${FONT}`;
    ctx.fillText(entry ? entry.name : "open slot", rowX - rowW / 2 + 38, y);
    ctx.textAlign = "right";
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = "rgba(230,244,255,0.6)";
    const tag = !entry ? "" : slot === 0 ? "HOST" : entry.connected ? "READY" : "reconnecting…";
    ctx.fillText(tag, rowX + rowW / 2 - 14, y);
  }
  ctx.globalAlpha = 1;

  const connected = view.players.filter((p) => p.connected).length;
  ctx.textAlign = "center";
  if (view.isHost) {
    if (connected >= 2) drawButton(ctx, r.start, "▶  START RUN", time, "#5dffb0");
    else {
      ctx.fillStyle = "rgba(230,244,255,0.6)";
      ctx.font = `700 ${short ? 12 : 15}px ${FONT}`;
      ctx.fillText(short ? "Start unlocks at 2 players" : "Share the code — start unlocks at 2 players", r.start.x + r.start.w / 2, r.start.y + r.start.h / 2);
    }
  } else {
    ctx.fillStyle = "rgba(230,244,255,0.7)";
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText("Waiting for host…", r.start.x + r.start.w / 2, r.start.y + r.start.h / 2);
  }
  drawButton(ctx, r.leave, "✕  LEAVE", time, PALETTE.danger, 16);
}

export function coopGameOverRects(w: number, h: number): { again: Rect; leave: Rect } {
  if (isShort(h)) {
    // Side by side along the bottom edge.
    const bw = Math.min(200, w * 0.32);
    const y = h - 56;
    return { again: { x: w / 2 - bw - 8, y, w: bw, h: 44 }, leave: { x: w / 2 + 8, y, w: bw, h: 44 } };
  }
  const again = primaryButtonRect(w, h);
  return { again, leave: { x: again.x, y: again.y + again.h + 12, w: again.w, h: 44 } };
}

export function drawCoopGameOver(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  info: OverInfo,
  isHost: boolean,
  best: RunStats | null,
  newBest: boolean,
): void {
  dim(ctx, w, h, 0.78);
  const short = isShort(h);
  neonTitle(ctx, "SQUAD SWARMED", w / 2, h * (short ? 0.09 : 0.16), Math.min(short ? 30 : 56, w * 0.09), time, w * 0.9);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#eafcff";
  ctx.font = `900 ${short ? 26 : 36}px ${FONT}`;
  ctx.fillText(formatTime(info.time), w / 2, h * (short ? 0.21 : 0.28));
  ctx.font = `600 15px ${FONT}`;
  ctx.fillStyle = "rgba(230,244,255,0.7)";
  ctx.fillText(`survived together  •  ${info.kills} kills  •  reached Lv ${info.level}`, w / 2, h * (short ? 0.21 : 0.28) + (short ? 22 : 30));

  info.perPlayer.forEach((p, i) => {
    const y = short ? h * 0.37 + i * 20 : h * 0.4 + i * 26;
    ctx.fillStyle = COOP.slotColors[p.slot] ?? PALETTE.player;
    ctx.font = `800 15px ${FONT}`;
    ctx.fillText(`${p.name}  —  ${p.kills} kills`, w / 2, y);
  });

  ctx.font = `700 15px ${FONT}`;
  if (newBest) {
    ctx.fillStyle = PALETTE.xp;
    ctx.fillText("★ NEW CO-OP BEST ★", w / 2, h * (short ? 0.71 : 0.56));
  } else if (best) {
    ctx.fillStyle = "rgba(230,244,255,0.5)";
    ctx.fillText(`co-op best  ${formatTime(best.time)}  •  ${best.kills} kills`, w / 2, h * (short ? 0.71 : 0.56));
  }

  const r = coopGameOverRects(w, h);
  if (isHost) drawButton(ctx, r.again, "↻  PLAY AGAIN", time, "#5dffb0");
  else {
    ctx.fillStyle = "rgba(230,244,255,0.7)";
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText("Waiting for host…", w / 2, r.again.y + r.again.h / 2);
  }
  drawButton(ctx, r.leave, "✕  LEAVE", time, PALETTE.danger, 16);
}

/** Esc in co-op: the run keeps going underneath, so this is a menu, not a pause. */
export function drawCoopMenu(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  dim(ctx, w, h, 0.45);
  const titleY = h * (isShort(h) ? 0.14 : 0.32);
  neonTitle(ctx, "MENU", w / 2, titleY, Math.min(isShort(h) ? 32 : 52, w * 0.08), time, w * 0.9);
  ctx.fillStyle = "rgba(230,244,255,0.7)";
  ctx.font = `600 14px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("The run keeps going — your squad needs you!", w / 2, titleY + (isShort(h) ? 26 : 40));
  drawButton(ctx, resumeButtonRect(w, h), "▶  BACK TO RUN", time, PALETTE.player);
  drawButton(ctx, quitButtonRect(w, h), "✕  LEAVE RUN", time, PALETTE.danger);
}

/** A centred pill near the top of the screen (host paused, toasts). */
export function drawBanner(ctx: CanvasRenderingContext2D, w: number, text: string, color = "#ffd27a"): void {
  ctx.font = `800 15px ${FONT}`;
  const tw = ctx.measureText(text).width + 40;
  const x = w / 2 - tw / 2;
  const y = 112;
  ctx.fillStyle = "rgba(3,4,8,0.8)";
  roundRect(ctx, x, y, tw, 36, 18);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, y + 18);
}

/** "Waiting on …" while you've picked and teammates are still choosing. */
export function drawHuddleWait(ctx: CanvasRenderingContext2D, w: number, h: number, names: string[]): void {
  dim(ctx, w, h, 0.5);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#eafcff";
  ctx.font = `800 22px ${FONT}`;
  ctx.fillText("SQUAD LEVEL UP", w / 2, h * 0.42);
  ctx.fillStyle = "rgba(230,244,255,0.7)";
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText(`waiting on ${names.join(", ")}…`, w / 2, h * 0.42 + 34);
}

const CALLSIGNS = ["BOLT", "NOVA", "FLUX", "VOLT", "ZAP", "ECHO", "PULSE", "ION", "ARC", "BYTE", "COIL", "RIVET"];

export function randomCallsign(rand: () => number = Math.random): string {
  return `${CALLSIGNS[Math.floor(rand() * CALLSIGNS.length)]}-${1 + Math.floor(rand() * 9)}`;
}
