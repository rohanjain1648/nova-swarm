/**
 * Fixed-angle top-down follow camera (matches the "top-down orbit" plan: a
 * stable, always-consistent viewing angle rather than a camera that swings
 * around behind the player — so the arena stays legible during a swarm).
 *
 * Screen shake reuses the "trauma squared" model from the 2D build: World
 * reports an impulse via `consumeTrauma()`, this class turns it into a
 * decaying random jitter of the camera position + a touch of roll.
 */
import * as THREE from "three";
import { RNG, damp } from "../core/math";
import type { World } from "../game/world";

const HEIGHT = 560;
const BACK = 430;

export class FollowCamera {
  private x = 0;
  private y = 0;
  private trauma = 0;
  private readonly rng = new RNG(7331);
  private shakeT = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.camera.position.set(0, HEIGHT, BACK);
    this.camera.lookAt(0, 0, 0);
  }

  /** Approximate radius (in ground-plane units) visible around the follow point — used for enemy spawn rings. */
  get viewRadius(): number {
    return HEIGHT * 1.55;
  }

  update(world: World, dt: number): void {
    const p = world.player;
    this.x = damp(this.x, p.x, 7, dt);
    this.y = damp(this.y, p.y, 7, dt);

    this.trauma = Math.max(0, this.trauma + world.consumeTrauma() - dt * 1.4);
    this.trauma = Math.min(1, this.trauma);
    this.shakeT += dt;

    const shake = this.trauma * this.trauma;
    const jx = shake * 22 * (this.rng.next() * 2 - 1);
    const jy = shake * 14 * (this.rng.next() * 2 - 1);
    const jz = shake * 22 * (this.rng.next() * 2 - 1);

    // Ground plane (x,y) maps to Three.js world (X,Z); Y is up.
    this.camera.position.set(this.x + jx, HEIGHT + jy, this.y + BACK + jz);
    this.camera.lookAt(this.x, 24, this.y);
    this.camera.rotation.z += shake * 0.02 * (this.rng.next() * 2 - 1);
  }
}
