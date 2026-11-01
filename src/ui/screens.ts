import { BOSS, ENEMIES, PALETTE } from "../game/config";
import type { EnemyKind } from "../game/config";
import type { Upgrade } from "../game/upgrades";
import type { World } from "../game/world";
import type { RunStats } from "../game/world";
import { formatTime } from "./hud";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const pointInRect = (px: number, py: number, r: Rect): boolean =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function dim(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
  ctx.fillStyle = `rgba(3,4,8,${alpha})`;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Font size <= maxSize (and >= minSize) such that `text` at `weight`-weight
 * Segoe UI fits within `maxWidth`. Font metrics scale linearly with size, so
 * one measurement at maxSize gives the exact fit — no shrink-and-remeasure
 * loop needed. This guards against real-device font-metric variance that a
 * fixed `size = f(viewportWidth)` formula can't account for.
 */
function fitFontSize(ctx: CanvasRenderingContext2D, text: string, weight: number, maxWidth: number, maxSize: number, minSize = 10): number {
  ctx.font = `${weight} ${maxSize}px 'Segoe UI', system-ui, sans-serif`;
  const measured = ctx.measureText(text).width;
  if (measured <= maxWidth || measured === 0) return maxSize;
  return Math.max(minSize, Math.floor((maxWidth / measured) * maxSize));
}

/** Big pulsing title text with an additive glow pass, auto-shrunk to always fit `maxWidth`. */
function neonTitle(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxSize: number, time: number, maxWidth: number): void {
  const size = fitFontSize(ctx, text, 900, maxWidth, maxSize);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${size}px 'Segoe UI', system-ui, sans-serif`;
  const pulse = 0.5 + Math.sin(time * 2) * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.shadowColor = PALETTE.player;
  ctx.shadowBlur = 24 + pulse * 20;
  ctx.fillStyle = PALETTE.player;
  ctx.fillText(text, x, y);
  ctx.restore();
  ctx.fillStyle = "#eafcff";
  ctx.fillText(text, x, y);
}

// ---- Start / restart button --------------------------------------------
export function primaryButtonRect(w: number, h: number): Rect {
  const bw = Math.min(280, w * 0.6);
  return { x: w / 2 - bw / 2, y: h * 0.62, w: bw, h: 56 };
}

/** Bounds of the title screen's "HOW TO PLAY" card — the single source of
 * truth for both drawing it and positioning the Play button beneath it, so
 * the two can never drift apart (e.g. the button overlapping the card on a
 * short/landscape viewport where a fixed fraction of `h` wouldn't leave
 * enough room for the card's fixed pixel height). */
export function titlePanelRect(w: number, h: number): Rect {
  const panelW = Math.min(640, w * 0.88);
  return { x: w / 2 - panelW / 2, y: h * 0.42, w: panelW, h: 210 };
}

/** The title screen's Play button sits below the how-to-play card (game-over
 * reuses `primaryButtonRect` unshifted since it has different content above). */
export function titlePlayButtonRect(w: number, h: number): Rect {
  const bw = Math.min(280, w * 0.6);
  const panel = titlePanelRect(w, h);
  return { x: w / 2 - bw / 2, y: panel.y + panel.h + 48, w: bw, h: 56 };
}

const ENEMY_LABELS: Record<EnemyKind, string> = {
  grunt: "Grunt",
  fast: "Fast",
  tank: "Tank",
  splitter: "Splitter",
  shooter: "Shooter",
  boss: "Warden",
};

interface LegendItem {
  color: string;
  label: string;
}

/**
 * A small caps section label, followed by a centered row of colored-dot legend
 * chips below it. The row shrinks (font, gap, dot size) to fit narrow/mobile
 * widths rather than overflowing off-screen — measured at a base size first,
 * then re-measured at the scaled-down size so spacing stays accurate.
 */
function drawLegendRow(ctx: CanvasRenderingContext2D, w: number, y: number, sectionLabel: string, items: LegendItem[]): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(230,244,255,0.38)";
  ctx.font = "800 10px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(sectionLabel, w / 2, y);

  const rowY = y + 20;
  const available = w * 0.94;
  const baseFontPx = 12;
  const baseGap = 20;
  const basePad = 15; // dot + spacing before each label

  const measure = (fontPx: number) => {
    ctx.font = `600 ${fontPx}px 'Segoe UI', system-ui, sans-serif`;
    const pad = basePad * (fontPx / baseFontPx);
    const widths = items.map((it) => pad + ctx.measureText(it.label).width);
    const gap = baseGap * (fontPx / baseFontPx);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
    return { widths, gap, total, pad };
  };

  let fontPx = baseFontPx;
  let m = measure(fontPx);
  if (m.total > available) {
    const scale = Math.max(0.55, available / m.total);
    fontPx = Math.round(baseFontPx * scale);
    m = measure(fontPx);
  }

  const dotR = Math.max(3, 5 * (fontPx / baseFontPx));
  let x = w / 2 - m.total / 2;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    ctx.beginPath();
    ctx.fillStyle = it.color;
    ctx.arc(x + dotR, rowY, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.font = `600 ${fontPx}px 'Segoe UI', system-ui, sans-serif`;
    ctx.fillStyle = "rgba(230,244,255,0.8)";
    ctx.fillText(it.label, x + m.pad - 1, rowY);
    x += m.widths[i] + m.gap;
  }
}

function drawButton(ctx: CanvasRenderingContext2D, r: Rect, label: string, time: number, color: string = PALETTE.player): void {
  const pulse = 0.5 + Math.sin(time * 4) * 0.5;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundRect(ctx, r.x, r.y, r.w, r.h, 14);
  ctx.fillStyle = `rgba(63,233,255,${0.08 + pulse * 0.06})`;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#eafcff";
  ctx.font = "800 20px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
}

export function muteButtonRect(w: number): Rect {
  return { x: w - 52, y: 16, w: 36, h: 36 };
}

// ---- Title screen --------------------------------------------------------
export function drawTitle(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, best: RunStats | null, muted: boolean): void {
  dim(ctx, w, h, 0.55);
  neonTitle(ctx, "NOVA SWARM", w / 2, h * 0.28, Math.min(72, w * 0.11), time, w * 0.92);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(230,244,255,0.75)";
  const taglineSize = fitFontSize(ctx, "Outlast the neon swarm. Level up. Build a deadly run.", 600, w * 0.92, 17);
  ctx.font = `600 ${taglineSize}px 'Segoe UI', system-ui, sans-serif`;
  ctx.fillText("Outlast the neon swarm. Level up. Build a deadly run.", w / 2, h * 0.28 + 52);

  // ---- Dedicated "HOW TO PLAY" panel: a bordered card (same visual language
  // as the level-up cards) so this reads as one clear section instead of
  // loose floating text — controls, enemy roster, and weapons all in one place.
  //
  // The whole panel-through-button block is drawn inside a canvas transform
  // that scales it down (anchored at the panel's top edge) on short viewports
  // — e.g. mobile landscape — where the fixed pixel layout below would
  // otherwise push the Play button off the bottom of the screen. On normal
  // desktop/portrait heights `scale` is 1 and this is a no-op.
  const panel = titlePanelRect(w, h);
  const panelX = panel.x;
  const panelTop = panel.y;
  const panelH = panel.h;
  const panelScale = Math.min(1, Math.max(0.6, h / 760));

  ctx.save();
  ctx.translate(w / 2, panelTop);
  ctx.scale(panelScale, panelScale);
  ctx.translate(-w / 2, -panelTop);

  ctx.save();
  roundRect(ctx, panelX, panelTop, panel.w, panelH, 16);
  const panelGrad = ctx.createLinearGradient(panelX, panelTop, panelX, panelTop + panelH);
  panelGrad.addColorStop(0, "rgba(20,28,48,0.55)");
  panelGrad.addColorStop(1, "rgba(8,10,20,0.55)");
  ctx.fillStyle = panelGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(63,233,255,0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = PALETTE.player;
  ctx.font = "800 15px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("HOW TO PLAY", w / 2, panelTop + 24);

  const controlsMaxW = panel.w * 0.92;
  const controls1 = "Move: WASD / Arrows / hold click  •  Fires where you steer";
  const controls2 = "Pick upgrades on level-up  •  M mutes  •  ESC pauses";
  const controlsSize = Math.min(
    fitFontSize(ctx, controls1, 500, controlsMaxW, 14),
    fitFontSize(ctx, controls2, 500, controlsMaxW, 14),
  );
  ctx.font = `500 ${controlsSize}px 'Segoe UI', system-ui, sans-serif`;
  ctx.fillStyle = "rgba(230,244,255,0.55)";
  ctx.fillText(controls1, w / 2, panelTop + 56);
  ctx.fillText(controls2, w / 2, panelTop + 80);

  // Enemy roster + weapon legend, sourced straight from the enemy/palette
  // data so it can't drift out of sync with the actual in-game colors.
  const enemyItems: LegendItem[] = (Object.keys(ENEMIES) as Exclude<EnemyKind, "boss">[]).map((k) => ({
    color: ENEMIES[k].color,
    label: ENEMY_LABELS[k],
  }));
  enemyItems.push({ color: BOSS.color, label: `${ENEMY_LABELS.boss} (boss)` });
  drawLegendRow(ctx, w, panelTop + 116, "ENEMIES", enemyItems);

  const weaponItems: LegendItem[] = [
    { color: PALETTE.bullet, label: "Blaster" },
    { color: PALETTE.orbital, label: "Orbital Shards" },
    { color: PALETTE.nova, label: "Pulse Nova" },
  ];
  drawLegendRow(ctx, w, panelTop + 166, "WEAPONS", weaponItems);

  if (best) {
    const bestText = `BEST  ${formatTime(best.time)}  •  ${best.kills} kills  •  Lv ${best.level}`;
    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.xp;
    const bestSize = fitFontSize(ctx, bestText, 700, panel.w * 0.92, 15);
    ctx.font = `700 ${bestSize}px 'Segoe UI', system-ui, sans-serif`;
    ctx.fillText(bestText, w / 2, panelTop + panelH + 28);
  }

  drawButton(ctx, titlePlayButtonRect(w, h), "▶  PLAY", time);
  ctx.restore(); // closes the panelScale transform

  // Mute toggle
  const mb = muteButtonRect(w);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  roundRect(ctx, mb.x, mb.y, mb.w, mb.h, 8);
  ctx.fill();
  ctx.fillStyle = "rgba(230,244,255,0.8)";
  ctx.font = "16px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(muted ? "🔇" : "🔊", mb.x + mb.w / 2, mb.y + mb.h / 2);
}

// ---- Level-up ------------------------------------------------------------
export function levelUpLayout(w: number, h: number): Rect[] {
  const n = 3;
  const gap = 18;
  const cardW = Math.min(280, (w - 60 - gap * (n - 1)) / n);
  const cardH = Math.min(340, h * 0.62);
  const totalW = cardW * n + gap * (n - 1);
  const startX = w / 2 - totalW / 2;
  const y = h / 2 - cardH / 2 + 20;
  const rects: Rect[] = [];
  for (let i = 0; i < n; i++) {
    rects.push({ x: startX + i * (cardW + gap), y, w: cardW, h: cardH });
  }
  return rects;
}

export function drawLevelUp(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  world: World,
  choices: Upgrade[],
  pointer: { x: number; y: number },
  time: number,
): void {
  dim(ctx, w, h, 0.72);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  neonTitle(ctx, "LEVEL UP", w / 2, h * 0.16, Math.min(48, w * 0.07), time, w * 0.9);
  ctx.fillStyle = "rgba(230,244,255,0.6)";
  ctx.font = "600 15px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("Choose an upgrade  —  click or press 1 / 2 / 3", w / 2, h * 0.16 + 40);

  const rects = levelUpLayout(w, h);
  for (let i = 0; i < choices.length; i++) {
    const u = choices[i];
    const r = rects[i];
    const hover = pointInRect(pointer.x, pointer.y, r);

    ctx.save();
    ctx.strokeStyle = u.color;
    ctx.lineWidth = hover ? 3 : 1.5;
    ctx.globalAlpha = hover ? 1 : 0.85;
    roundRect(ctx, r.x, r.y, r.w, r.h, 16);
    const grad = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    grad.addColorStop(0, "rgba(20,28,48,0.95)");
    grad.addColorStop(1, "rgba(8,10,20,0.95)");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Icon
    ctx.fillStyle = u.color;
    ctx.font = "700 46px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(u.icon, r.x + r.w / 2, r.y + 64);

    // Name
    ctx.fillStyle = "#eafcff";
    ctx.font = "800 20px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(u.name, r.x + r.w / 2, r.y + 118);

    // Level label
    const label = world.choiceLabel(u);
    if (label) {
      ctx.fillStyle = u.color;
      ctx.font = "700 13px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText(label, r.x + r.w / 2, r.y + 144);
    }

    // Description (wrapped)
    ctx.fillStyle = "rgba(230,244,255,0.75)";
    ctx.font = "500 14px 'Segoe UI', system-ui, sans-serif";
    wrapText(ctx, u.desc(world.player), r.x + r.w / 2, r.y + 176, r.w - 32, 20);

    // Number key hint
    ctx.fillStyle = u.color;
    ctx.font = "800 16px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(`${i + 1}`, r.x + r.w / 2, r.y + r.h - 26);
  }
}

// ---- Pause ---------------------------------------------------------------
export function resumeButtonRect(w: number, h: number): Rect {
  const bw = Math.min(280, w * 0.6);
  return { x: w / 2 - bw / 2, y: h * 0.55, w: bw, h: 56 };
}

export function quitButtonRect(w: number, h: number): Rect {
  const bw = Math.min(280, w * 0.6);
  return { x: w / 2 - bw / 2, y: h * 0.55 + 70, w: bw, h: 56 };
}

export function drawPause(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  dim(ctx, w, h, 0.6);
  neonTitle(ctx, "PAUSED", w / 2, h * 0.32, Math.min(52, w * 0.08), time, w * 0.9);
  ctx.fillStyle = "rgba(230,244,255,0.6)";
  ctx.font = "600 14px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("ESC / SPACE to resume  •  Q to quit to menu", w / 2, h * 0.32 + 40);

  drawButton(ctx, resumeButtonRect(w, h), "▶  RESUME", time, PALETTE.player);
  drawButton(ctx, quitButtonRect(w, h), "✕  QUIT TO MENU", time, PALETTE.danger);
}

// ---- Game over -----------------------------------------------------------
export function drawGameOver(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  stats: RunStats,
  best: RunStats | null,
  newBest: boolean,
  time: number,
): void {
  dim(ctx, w, h, 0.78);
  neonTitle(ctx, "SWARMED", w / 2, h * 0.24, Math.min(64, w * 0.1), time, w * 0.9);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#eafcff";
  ctx.font = "900 40px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(formatTime(stats.time), w / 2, h * 0.42);
  ctx.font = "600 16px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = "rgba(230,244,255,0.7)";
  ctx.fillText(`survived  •  ${stats.kills} kills  •  reached Lv ${stats.level}`, w / 2, h * 0.42 + 34);

  if (newBest) {
    ctx.fillStyle = PALETTE.xp;
    ctx.font = "800 18px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("★ NEW BEST ★", w / 2, h * 0.52);
  } else if (best) {
    ctx.fillStyle = "rgba(230,244,255,0.5)";
    ctx.font = "600 14px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(`best  ${formatTime(best.time)}  •  ${best.kills} kills`, w / 2, h * 0.52);
  }

  drawButton(ctx, primaryButtonRect(w, h), "↻  PLAY AGAIN", time, PALETTE.danger);
}

// ---- helpers -------------------------------------------------------------
function wrapText(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, maxW: number, lh: number): void {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, cx, yy);
      line = word;
      yy += lh;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, cx, yy);
}
