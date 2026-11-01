import { PLAYER } from "./config";
import { clamp } from "../core/math";

/**
 * The player: position/physics plus a flat "stats" bag that every weapon and
 * system reads from. Upgrades simply mutate these fields, which keeps the
 * upgrade system decoupled from weapon internals.
 */
export class Player {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  facing = 0; // radians, heading (cursor aim, else movement) — drives the 3D model's body rotation

  hp: number;
  invuln = 0; // i-frame timer
  hurtFlash = 0;

  // --- Stats (mutated by upgrades) ---
  maxHp = PLAYER.baseHp;
  speed = PLAYER.baseSpeed;
  pickupRadius = PLAYER.basePickupRadius;
  regen = PLAYER.baseRegen;
  armor = 0; // flat reduction, capped in applyDamage

  damageMul = 1;
  fireRateMul = 1; // >1 = faster
  projectileCount = 1;
  pierceBonus = 0;
  projSpeedMul = 1;
  critChance = 0.0;
  critMul = 2.0;
  xpMul = 1;

  // --- Weapon levels (0 = not yet owned, except blaster) ---
  blaster = 1;
  orbital = 0;
  nova = 0;

  // --- Weapon runtime cooldowns / state ---
  blasterCd = 0;
  novaCd = 0;
  orbitAngle = 0;
  regenFrac = 0; // accumulates fractional hp

  constructor() {
    this.hp = this.maxHp;
  }

  reset(): void {
    this.x = this.y = this.vx = this.vy = 0;
    this.facing = 0;
    this.maxHp = PLAYER.baseHp;
    this.speed = PLAYER.baseSpeed;
    this.pickupRadius = PLAYER.basePickupRadius;
    this.regen = PLAYER.baseRegen;
    this.armor = 0;
    this.damageMul = 1;
    this.fireRateMul = 1;
    this.projectileCount = 1;
    this.pierceBonus = 0;
    this.projSpeedMul = 1;
    this.critChance = 0;
    this.critMul = 2;
    this.xpMul = 1;
    this.blaster = 1;
    this.orbital = 0;
    this.nova = 0;
    this.blasterCd = 0;
    this.novaCd = 0;
    this.orbitAngle = 0;
    this.invuln = 0;
    this.hurtFlash = 0;
    this.regenFrac = 0;
    this.hp = this.maxHp;
  }

  get radius(): number {
    return PLAYER.radius;
  }

  /** Blaster shots per second, derived from level + fire-rate stat. */
  get blasterInterval(): number {
    const base = 0.55 - (this.blaster - 1) * 0.045; // faster per level
    return clamp(base, 0.12, 1) / this.fireRateMul;
  }

  get blasterDamage(): number {
    return (6 + (this.blaster - 1) * 3) * this.damageMul;
  }

  /** Total projectiles per volley. */
  get blasterProjectiles(): number {
    return this.projectileCount + Math.floor((this.blaster - 1) / 3);
  }

  get orbitalCount(): number {
    return this.orbital <= 0 ? 0 : 1 + this.orbital;
  }
  get orbitalDamage(): number {
    return (5 + this.orbital * 3) * this.damageMul;
  }
  get orbitalRadius(): number {
    return 70 + this.orbital * 8;
  }

  get novaInterval(): number {
    return clamp(3.4 - this.nova * 0.28, 1.1, 3.4) / this.fireRateMul;
  }
  get novaRadius(): number {
    return 120 + this.nova * 26;
  }
  get novaDamage(): number {
    return (14 + this.nova * 8) * this.damageMul;
  }

  /** Apply incoming damage through armor + i-frames. Returns true if it hurt. */
  takeDamage(raw: number): boolean {
    if (this.invuln > 0) return false;
    const dmg = Math.max(1, raw - this.armor);
    this.hp -= dmg;
    this.invuln = PLAYER.iFrames;
    this.hurtFlash = 1;
    return true;
  }
}
