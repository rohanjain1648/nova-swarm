import type { EnemyKind, RobotAnim } from "./config";

/**
 * All mutable game entities are plain structs kept in pooled arrays, indexed
 * by their position in World's arrays (e.g. `enemies[3]`). The 3D renderer
 * keeps a parallel array of Three.js objects at the same indices, so a pool
 * slot's visual identity is stable for as long as the slot is reused.
 */

export interface Enemy {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  touchDamage: number;
  xp: number;
  kind: EnemyKind;
  color: string;
  modelScale: number;
  anim: RobotAnim;
  animSpeed: number;
  dead: boolean;
  /** White hit-flash timer, counts down to 0. */
  flash: number;
  /** Knockback velocity applied on hit, decays fast. */
  kbx: number;
  kby: number;
  shootCd: number;
  isBoss: boolean;
  splitInto?: EnemyKind;
  spawnT: number; // time alive, for spawn-in animation
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  pierce: number; // remaining hits before despawn
  life: number; // seconds remaining
  dead: boolean;
  crit: boolean;
  /** Set of enemies already hit (prevents multi-hitting a pierced target). */
  hitCd: number;
}

export interface EnemyBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
  dead: boolean;
}

export interface Gem {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  value: number;
  dead: boolean;
  magnet: boolean;
  kind: "xp" | "heal";
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  dead: boolean;
  drag: number;
}

export interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
  size: number;
  dead: boolean;
}
