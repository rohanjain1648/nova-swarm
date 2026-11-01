import * as THREE from "three";
import type { FloatLabel } from "../render/worldView";

const v = new THREE.Vector3();

/** Project world-space floating combat text (crit numbers, "+HP") onto the 2D HUD canvas. */
export function drawFloatLabels(
  ctx: CanvasRenderingContext2D,
  labels: readonly FloatLabel[],
  camera: THREE.Camera,
  w: number,
  h: number,
): void {
  if (labels.length === 0) return;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const l of labels) {
    v.set(l.x, l.y, l.z).project(camera);
    if (v.z < -1 || v.z > 1) continue;
    const sx = (v.x * 0.5 + 0.5) * w;
    const sy = (1 - (v.y * 0.5 + 0.5)) * h;
    ctx.globalAlpha = l.alpha;
    ctx.font = `900 ${l.size}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, sx, sy);
  }
  ctx.globalAlpha = 1;
}
