import { clamp } from "../core/math";
import { PALETTE } from "../game/config";
import type { World } from "../game/world";

export const formatTime = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

function bar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  color: string,
  bg = "rgba(255,255,255,0.08)",
): void {
  ctx.fillStyle = bg;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  if (frac > 0) {
    ctx.fillStyle = color;
    roundRect(ctx, x, y, Math.max(h, w * clamp(frac, 0, 1)), h, h / 2);
    ctx.fill();
  }
}

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

/** Draw the in-game HUD in screen space (no camera transform). */
export function drawHud(ctx: CanvasRenderingContext2D, world: World, muted: boolean, w: number, h: number): void {
  const p = world.player;
  const pad = 16;

  // XP bar across the very top
  bar(ctx, 0, 0, w, 6, world.xp / world.xpToNext, PALETTE.xp, "rgba(255,255,255,0.05)");

  // Level chip (top-left)
  ctx.font = "800 15px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = PALETTE.xp;
  ctx.fillText(`LV ${world.level}`, pad, 14);

  // HP bar (top-left, under level)
  const hpW = Math.min(240, w * 0.4);
  bar(ctx, pad, 36, hpW, 14, p.hp / p.maxHp, p.hp / p.maxHp < 0.35 ? PALETTE.danger : "#4dff9b");
  ctx.font = "700 12px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = PALETTE.text;
  ctx.textBaseline = "middle";
  ctx.fillText(`${Math.max(0, Math.ceil(p.hp))} / ${p.maxHp}`, pad + 8, 36 + 7);

  // Timer + kills (top-center)
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = PALETTE.text;
  ctx.font = "900 34px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(formatTime(world.time), w / 2, 14);
  ctx.font = "700 14px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = "rgba(230,244,255,0.7)";
  ctx.fillText(`${world.kills} killed`, w / 2, 52);

  // Boss bar (center, below timer)
  const bossFrac = world.bossHpFraction;
  if (bossFrac != null) {
    const bw = Math.min(420, w * 0.6);
    ctx.font = "800 12px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = "#ffd27a";
    ctx.fillText("◆ WARDEN ◆", w / 2, 74);
    bar(ctx, w / 2 - bw / 2, 90, bw, 12, bossFrac, "#ffcf5a", "rgba(255,80,80,0.15)");
  }

  // Weapon chips (bottom-left)
  const chips: { icon: string; lvl: number; color: string }[] = [
    { icon: "➤", lvl: p.blaster, color: PALETTE.bullet },
  ];
  if (p.orbital > 0) chips.push({ icon: "◉", lvl: p.orbital, color: PALETTE.orbital });
  if (p.nova > 0) chips.push({ icon: "◎", lvl: p.nova, color: PALETTE.nova });
  let cx = pad;
  const cy = h - 44;
  for (const c of chips) {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    roundRect(ctx, cx, cy, 54, 30, 8);
    ctx.fill();
    ctx.fillStyle = c.color;
    ctx.font = "700 16px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(c.icon, cx + 8, cy + 15);
    ctx.fillStyle = PALETTE.text;
    ctx.font = "800 13px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(`${c.lvl}`, cx + 34, cy + 15);
    cx += 62;
  }

  // Mute indicator (top-right)
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.font = "700 13px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = "rgba(230,244,255,0.55)";
  ctx.fillText(muted ? "🔇 M" : "🔊 M", w - pad, 14);
  ctx.fillText("ESC pause", w - pad, 34);
}
