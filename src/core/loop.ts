/**
 * Fixed-timestep game loop with a render interpolation hook.
 *
 * Simulation advances in fixed STEP increments so physics/spawning are
 * deterministic and frame-rate independent; rendering runs once per rAF with
 * an `alpha` describing how far we are between sim steps (for smooth motion on
 * high-refresh displays). A frame-time clamp prevents the "spiral of death"
 * after a tab is backgrounded.
 */

export type UpdateFn = (dt: number) => void;
export type RenderFn = (alpha: number) => void;

export class GameLoop {
  readonly step: number; // fixed sim step, seconds
  private accumulator = 0;
  private last = 0;
  private rafId = 0;
  private running = false;

  constructor(
    private readonly update: UpdateFn,
    private readonly render: RenderFn,
    stepHz = 60,
  ) {
    this.step = 1 / stepHz;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    // Clamp to 0.25s: if the tab was hidden we don't try to catch up on
    // thousands of steps at once.
    let frame = (now - this.last) / 1000;
    this.last = now;
    if (frame > 0.25) frame = 0.25;

    this.accumulator += frame;
    while (this.accumulator >= this.step) {
      this.update(this.step);
      this.accumulator -= this.step;
    }

    this.render(this.accumulator / this.step);
  };
}
