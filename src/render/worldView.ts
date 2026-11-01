/**
 * Syncs World's plain-data pools onto Three.js objects every frame. This is
 * the only place that knows both "gameplay data shape" and "Three.js scene
 * graph" — World stays renderer-agnostic, and everything here is read-only
 * with respect to gameplay state.
 */
import * as THREE from "three";
import { clamp } from "../core/math";
import { PALETTE } from "../game/config";
import type { World } from "../game/world";
import { RobotFactory, type RobotHandle } from "./robots";
import { createFxPools, RingPool, type FxPools } from "./fx";

const hexToNum = (s: string): number => parseInt(s.replace("#", ""), 16);

// Robots face +Z at rotation.y = 0 in this asset; tune if that's ever wrong.
const FORWARD_OFFSET = Math.PI / 2;

export interface FloatLabel {
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  alpha: number;
  size: number;
}

export class WorldView {
  private player!: RobotHandle;
  private readonly robots: RobotHandle[] = [];
  private readonly orbitals: THREE.Mesh[] = [];
  private pickupRing!: THREE.Mesh;
  private novaRings!: RingPool;
  private fx!: FxPools;
  /** Recomputed each sync(); read by the HUD overlay to draw floating combat text in screen space. */
  readonly floatLabels: FloatLabel[] = [];
  /** World-space scale applied to every robot instance; calibrated once the model loads. */
  robotBaseScale = 60;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly factory: RobotFactory,
  ) {
    this.player = factory.create();
    this.player.setTint(hexToNum(PALETTE.player));
    this.player.root.castShadow = true;
    scene.add(this.player.root);

    for (let i = 0; i < 8; i++) {
      const geo = new THREE.IcosahedronGeometry(9, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: hexToNum(PALETTE.orbital),
        emissive: hexToNum(PALETTE.orbital),
        emissiveIntensity: 1.4,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.orbitals.push(mesh);
    }

    const ringGeo = new THREE.RingGeometry(1, 1.04, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: hexToNum(PALETTE.player),
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.pickupRing = new THREE.Mesh(ringGeo, ringMat);
    this.pickupRing.rotation.x = -Math.PI / 2;
    this.pickupRing.position.y = 1;
    scene.add(this.pickupRing);

    this.novaRings = new RingPool(scene, hexToNum(PALETTE.nova));
    this.fx = createFxPools(scene, {
      bullet: hexToNum(PALETTE.bullet),
      enemyBullet: hexToNum(PALETTE.enemyBullet),
      xp: hexToNum(PALETTE.xp),
      heal: hexToNum(PALETTE.heal),
      danger: hexToNum(PALETTE.danger),
    });
  }

  /** Call once the GLB has loaded to size robots sensibly relative to the arena. */
  calibrateScale(desiredPlayerHeight: number): void {
    const natural = this.factory.naturalHeight;
    this.robotBaseScale = natural > 0 ? desiredPlayerHeight / natural : this.robotBaseScale;
  }

  private ensureRobotCapacity(n: number): void {
    while (this.robots.length < n) {
      const h = this.factory.create();
      h.root.visible = false;
      h.root.castShadow = true;
      this.scene.add(h.root);
      this.robots.push(h);
    }
  }

  sync(world: World, dt: number): void {
    this.floatLabels.length = 0;
    const p = world.player;

    // --- Player -------------------------------------------------------
    const moving = Math.hypot(p.vx, p.vy) > 12;
    this.player.root.position.set(p.x, 0, p.y);
    this.player.root.rotation.y = FORWARD_OFFSET - p.facing;
    this.player.root.scale.setScalar(this.robotBaseScale);
    if (world.gameOver) {
      this.player.play("Death", 0.2);
      this.player.root.visible = true;
    } else {
      this.player.play(moving ? "Running" : "Idle", 0.15);
      this.player.setSpeed(moving ? 1.15 : 1);
      const blinking = p.invuln > 0 && Math.floor(world.time * 20) % 2 === 0;
      this.player.root.visible = !blinking;
    }
    this.player.update(dt);

    // Pickup radius ring + orbitals only make sense mid-run.
    this.pickupRing.visible = !world.gameOver;
    this.pickupRing.position.x = p.x;
    this.pickupRing.position.z = p.y;
    this.pickupRing.scale.setScalar(p.pickupRadius);

    const orbitalCount = world.gameOver ? 0 : p.orbitalCount;
    for (let i = 0; i < this.orbitals.length; i++) {
      if (i < orbitalCount) {
        const a = p.orbitAngle + (i / orbitalCount) * Math.PI * 2;
        this.orbitals[i].visible = true;
        this.orbitals[i].position.set(p.x + Math.cos(a) * p.orbitalRadius, 26, p.y + Math.sin(a) * p.orbitalRadius);
        this.orbitals[i].rotation.y += dt * 4;
      } else {
        this.orbitals[i].visible = false;
      }
    }

    // --- Enemies --------------------------------------------------------
    this.ensureRobotCapacity(world.enemies.length);
    for (let i = 0; i < world.enemies.length; i++) {
      const e = world.enemies[i];
      const h = this.robots[i];
      if (e.dead) {
        h.root.visible = false;
        continue;
      }
      h.root.visible = true;
      h.root.position.set(e.x, 0, e.y);
      const angle = Math.atan2(p.y - e.y, p.x - e.x);
      h.root.rotation.y = FORWARD_OFFSET - angle;

      const spawnIn = e.spawnT < 0.4;
      const spawnScale = spawnIn ? clamp(e.spawnT / 0.4, 0.15, 1) : 1;
      h.root.scale.setScalar(this.robotBaseScale * e.modelScale * spawnScale);

      h.play(spawnIn ? "Idle" : e.anim, 0.2);
      h.setSpeed(spawnIn ? 1 : e.animSpeed);
      h.setTint(e.flash > 0 ? 0xffffff : hexToNum(e.color));
      h.update(dt);
    }

    this.syncFx(world);
  }

  private syncFx(world: World): void {
    const fx = this.fx;
    let i = 0;
    for (; i < world.bullets.length; i++) {
      const b = world.bullets[i];
      if (b.dead) fx.bullets.hide(i);
      else fx.bullets.set(i, b.x, 18, b.y, b.radius * 1.3);
    }
    fx.bullets.hideFrom(world.bullets.length);
    fx.bullets.finish();

    for (i = 0; i < world.enemyBullets.length; i++) {
      const b = world.enemyBullets[i];
      if (b.dead) fx.enemyBullets.hide(i);
      else fx.enemyBullets.set(i, b.x, 20, b.y, b.radius * 1.2);
    }
    fx.enemyBullets.hideFrom(world.enemyBullets.length);
    fx.enemyBullets.finish();

    // Gems are split across two fixed-color pools (xp/heal), so each pool
    // gets its own compact index sequence rather than sharing world.gems'
    // indices directly.
    let xpI = 0;
    let healI = 0;
    for (i = 0; i < world.gems.length; i++) {
      const g = world.gems[i];
      if (g.dead) continue;
      const bob = 14 + Math.sin(world.time * 6 + g.x) * 4;
      if (g.kind === "heal") fx.gemsHeal.set(healI++, g.x, bob, g.y, g.radius * 1.1);
      else fx.gemsXp.set(xpI++, g.x, bob, g.y, g.radius * 1.1);
    }
    fx.gemsXp.hideFrom(xpI);
    fx.gemsHeal.hideFrom(healI);
    fx.gemsXp.finish();
    fx.gemsHeal.finish();

    // Same reassignment trick for particles: danger-red hurt sparks vs
    // everything else (hit/kill flashes), each into their own fixed-color pool.
    let sparkI = 0;
    let hurtI = 0;
    const items = world.particles.items;
    for (i = 0; i < items.length; i++) {
      const pt = items[i];
      if (pt.dead) continue;
      const a = clamp(pt.life / pt.maxLife, 0, 1);
      const scale = pt.size * a * 0.9;
      if (pt.color === PALETTE.danger) fx.hurtSparks.set(hurtI++, pt.x, 16, pt.y, scale);
      else fx.sparks.set(sparkI++, pt.x, 16, pt.y, scale);
    }
    fx.sparks.hideFrom(sparkI);
    fx.hurtSparks.hideFrom(hurtI);
    fx.sparks.finish();
    fx.hurtSparks.finish();

    this.novaRings.sync(world.novaRings);

    const texts = world.particles.texts;
    for (let t = 0; t < texts.length; t++) {
      const ft = texts[t];
      if (ft.dead) continue;
      this.floatLabels.push({
        x: ft.x,
        y: 40,
        z: ft.y,
        text: ft.text,
        color: ft.color,
        alpha: clamp(ft.life / ft.maxLife, 0, 1),
        size: ft.size,
      });
    }
  }
}
