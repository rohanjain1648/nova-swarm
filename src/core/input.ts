/**
 * Unified input: keyboard (WASD/arrows) + pointer (mouse/touch drag).
 *
 * Exposes a normalized movement vector so gameplay code never cares whether
 * the player is on desktop or mobile. On touch, dragging anywhere produces a
 * virtual analogue stick relative to the touch's origin.
 */

import { clamp, len } from "./math";

export class Input {
  private keys = new Set<string>();
  private pointerActive = false;
  private pointerOriginX = 0;
  private pointerOriginY = 0;
  private pointerX = 0;
  private pointerY = 0;
  private usingTouch = false;

  /** One-shot "confirm/start" edge, consumed by the UI layer. */
  private pressedConfirm = false;
  /** Number keys 1..3 for level-up choices (edge-triggered). */
  private numberPressed = 0;
  /** Generic per-key edge buffer (consumed once per physical press). */
  private edges = new Set<string>();
  /** Pointer-press edge with the position where it happened. */
  private clicked = false;
  private clickX = 0;
  private clickY = 0;

  readonly move = { x: 0, y: 0 };

  constructor(target: HTMLElement) {
    addEventListener("keydown", this.onKeyDown, { passive: false });
    addEventListener("keyup", this.onKeyUp);
    target.addEventListener("pointerdown", this.onPointerDown);
    addEventListener("pointermove", this.onPointerMove);
    addEventListener("pointerup", this.onPointerUp);
    addEventListener("pointercancel", this.onPointerUp);
    addEventListener("blur", this.releaseAll);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Prevent page scroll on arrows/space during play.
    if (
      e.code === "Space" ||
      e.code.startsWith("Arrow") ||
      e.code === "Tab"
    ) {
      e.preventDefault();
    }
    if (!this.keys.has(e.code)) {
      this.edges.add(e.code);
      if (e.code === "Space" || e.code === "Enter") this.pressedConfirm = true;
      if (e.code === "Digit1" || e.code === "Numpad1") this.numberPressed = 1;
      if (e.code === "Digit2" || e.code === "Numpad2") this.numberPressed = 2;
      if (e.code === "Digit3" || e.code === "Numpad3") this.numberPressed = 3;
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.usingTouch = e.pointerType === "touch";
    this.pointerActive = true;
    this.pointerOriginX = this.pointerX = e.clientX;
    this.pointerOriginY = this.pointerY = e.clientY;
    this.pressedConfirm = true;
    this.clicked = true;
    this.clickX = e.clientX;
    this.clickY = e.clientY;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointerActive) return;
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
  };

  private onPointerUp = (): void => {
    this.pointerActive = false;
  };

  private releaseAll = (): void => {
    this.keys.clear();
    this.pointerActive = false;
  };

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Read + clear the confirm edge. */
  consumeConfirm(): boolean {
    const v = this.pressedConfirm;
    this.pressedConfirm = false;
    return v;
  }

  /** Read + clear a 1..3 selection edge (0 = none). */
  consumeNumber(): number {
    const v = this.numberPressed;
    this.numberPressed = 0;
    return v;
  }

  /** Read + clear a pointer click, returning its position or null. */
  consumeClick(): { x: number; y: number } | null {
    if (!this.clicked) return null;
    this.clicked = false;
    return { x: this.clickX, y: this.clickY };
  }

  /** True once per physical key press for the given code. */
  consumeKey(code: string): boolean {
    if (this.edges.has(code)) {
      this.edges.delete(code);
      return true;
    }
    return false;
  }

  get pointerPosition(): { x: number; y: number } {
    return { x: this.pointerX, y: this.pointerY };
  }

  get isPointerActive(): boolean {
    return this.pointerActive;
  }

  /**
   * Recompute the normalized movement vector. Called once per sim step.
   * Keyboard takes priority; otherwise a touch/mouse drag acts as a stick.
   */
  update(): void {
    let x = 0;
    let y = 0;

    if (this.isDown("KeyA", "ArrowLeft")) x -= 1;
    if (this.isDown("KeyD", "ArrowRight")) x += 1;
    if (this.isDown("KeyW", "ArrowUp")) y -= 1;
    if (this.isDown("KeyS", "ArrowDown")) y += 1;

    if (x === 0 && y === 0 && this.pointerActive) {
      // Virtual stick. Touch: relative to where the finger went down.
      // Mouse: relative to the screen centre (the camera keeps the robot
      // there), so holding the button steers the robot toward the cursor —
      // click in a direction and the robot moves that way.
      const originX = this.usingTouch ? this.pointerOriginX : innerWidth / 2;
      const originY = this.usingTouch ? this.pointerOriginY : innerHeight / 2;
      const dx = this.pointerX - originX;
      const dy = this.pointerY - originY;
      const l = len(dx, dy);
      const dead = this.usingTouch ? 8 : 24;
      const full = this.usingTouch ? 70 : 150;
      if (l > dead) {
        const mag = clamp((l - dead) / (full - dead), 0, 1);
        x = (dx / l) * mag;
        y = (dy / l) * mag;
      }
    }

    // Normalize diagonals for keyboard so you don't move faster on the angle.
    const l = len(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    this.move.x = x;
    this.move.y = y;
  }
}
