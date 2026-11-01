import * as THREE from "three";
import { clamp } from "../core/math";
import { COOP, PALETTE } from "../game/config";
import type { World } from "../game/world";
import type { Rect } from "./screens";

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

/** Touch-friendly ping button (co-op only), bottom-right above the safe area. */
export function pingButtonRect(w: number, h: number): Rect {
  return { x: w - 16 - 64, y: h - 16 - 64, w: 64, h: 64 };
}

/** Draw the in-game HUD in screen space (no camera transform). */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  world: World,
  muted: boolean,
  w: number,
  h: number,
  camera?: THREE.Camera,
): void {
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
  ctx.fillText(world.players.length > 1 ? "ESC menu · G ping" : "ESC pause", w - pad, 34);

  if (world.players.length > 1) {
    drawTeammates(ctx, world, pad, 60);
    if (camera) drawEdgeArrows(ctx, world, camera, w, h);
    drawPingButton(ctx, world, w, h);
  }
}

/** Teammate rows under your HP bar: name in slot colour, mini HP bar, DOWN tag. */
function drawTeammates(ctx: CanvasRenderingContext2D, world: World, x: number, y: number): void {
  let row = 0;
  for (const p of world.players) {
    if (!p.active || p.slot === world.localSlot) continue;
    const ry = y + row * 22;
    const color = COOP.slotColors[p.slot] ?? PALETTE.player;
    ctx.font = "800 12px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(p.name, x, ry + 5);
    if (p.downed) {
      ctx.fillStyle = PALETTE.danger;
      ctx.fillText(`DOWN ${Math.round(p.reviveT * 100)}%`, x + 96, ry + 5);
    } else {
      bar(ctx, x + 96, ry, 90, 10, p.hp / p.maxHp, color);
    }
    row++;
  }
}

const proj = new THREE.Vector3();

/** Arrows on the screen edge toward teammates and pings that are off-screen. */
function drawEdgeArrows(ctx: CanvasRenderingContext2D, world: World, camera: THREE.Camera, w: number, h: number): void {
  const targets: { x: number; y: number; color: string; ping: boolean }[] = [];
  for (const p of world.players) {
    if (p.active && p.slot !== world.localSlot) {
      targets.push({ x: p.x, y: p.y, color: COOP.slotColors[p.slot] ?? PALETTE.player, ping: false });
    }
  }
  for (const pg of world.pings) targets.push({ x: pg.x, y: pg.y, color: COOP.slotColors[pg.slot] ?? PALETTE.player, ping: true });

  const margin = 28;
  for (const t of targets) {
    proj.set(t.x, 0, t.y).project(camera);
    let sx = (proj.x * 0.5 + 0.5) * w;
    let sy = (1 - (proj.y * 0.5 + 0.5)) * h;
    if (proj.z > 1) {
      // Behind the camera: mirror so the arrow still points the right way.
      sx = w - sx;
      sy = h - sy;
    }
    const onScreen = proj.z <= 1 && sx >= margin && sx <= w - margin && sy >= margin && sy <= h - margin;
    if (onScreen) continue;
    const cx = w / 2;
    const cy = h / 2;
    const a = Math.atan2(sy - cy, sx - cx);
    // Push the point out from the centre until it meets the inset screen rectangle.
    const kx = (w / 2 - margin) / Math.max(1e-6, Math.abs(Math.cos(a)));
    const ky = (h / 2 - margin) / Math.max(1e-6, Math.abs(Math.sin(a)));
    const k = Math.min(kx, ky);
    const ax = cx + Math.cos(a) * k;
    const ay = cy + Math.sin(a) * k;

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(a);
    ctx.fillStyle = t.color;
    ctx.globalAlpha = t.ping ? 0.95 : 0.8;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, -10);
    ctx.lineTo(-8, 10);
    ctx.closePath();
    ctx.fill();
    if (t.ping) {
      ctx.rotate(-a);
      ctx.font = "900 14px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", -Math.cos(a) * 22, -Math.sin(a) * 22);
    }
    ctx.restore();
  }
}

function drawPingButton(ctx: CanvasRenderingContext2D, world: World, w: number, h: number): void {
  const r = pingButtonRect(w, h);
  const ready = world.player.pingCd <= 0 && !world.player.downed;
  ctx.globalAlpha = ready ? 0.9 : 0.35;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  roundRect(ctx, r.x, r.y, r.w, r.h, 32);
  ctx.fill();
  ctx.strokeStyle = COOP.slotColors[world.localSlot] ?? PALETTE.player;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = PALETTE.text;
  ctx.font = "900 26px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", r.x + r.w / 2, r.y + r.h / 2 - 4);
  ctx.font = "700 10px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("PING", r.x + r.w / 2, r.y + r.h - 14);
  ctx.globalAlpha = 1;
}
