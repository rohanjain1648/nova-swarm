/**
 * Central tuning: every gameplay-facing constant lives here so balance can be
 * adjusted in one place. Colors are reused by the 3D renderer (robot material
 * tint, particle/light colors) and the 2D HUD overlay for a consistent palette.
 *
 * The world simulation still runs on a flat (x, y) ground plane in "game
 * units" — the 3D renderer maps x,y directly to Three.js world X,Z (Y is up)
 * at a 1:1 scale, so all collision/spawn math below is untouched from the 2D
 * version. Visual size (`modelScale`) is tuned independently of the gameplay
 * collision `radius`.
 */

export const WORLD = {
  /** Half-size of the square arena; play space is [-W, W] on both axes. */
  half: 1600,
  gridCell: 128, // spatial hash cell size
  bgGrid: 80, // background grid spacing in world units
};

export const PALETTE = {
  player: "#3fe9ff",
  bullet: "#c9fbff",
  orbital: "#7cf5ff",
  nova: "#8affc8",
  xp: "#8dff5a",
  heal: "#ff6ba8",
  enemyBullet: "#ff5a5a",
  text: "#eaf6ff",
  danger: "#ff3d6e",
} as const;

export type EnemyKind = "grunt" | "fast" | "tank" | "splitter" | "shooter" | "boss";

/** Which RobotExpressive.glb clip an enemy tier walks/idles with. */
export type RobotAnim = "Walking" | "Running" | "Idle";

export interface EnemyDef {
  kind: EnemyKind;
  color: string;
  radius: number;
  /** Visual scale multiplier for the robot model (independent of collision `radius`). */
  modelScale: number;
  anim: RobotAnim;
  /** Animation playback-rate multiplier (e.g. a slow heavy stomp for tanks/boss). */
  animSpeed: number;
  baseHp: number;
  baseSpeed: number;
  touchDamage: number;
  xp: number;
  /** Earliest run-time (seconds) this type may start spawning. */
  unlockAt: number;
  /** Relative spawn weight once unlocked. */
  weight: number;
  shooter?: { range: number; cooldown: number; bulletSpeed: number; bulletDmg: number };
  splitInto?: EnemyKind;
}

export const ENEMIES: Record<Exclude<EnemyKind, "boss">, EnemyDef> = {
  grunt: {
    kind: "grunt",
    color: "#ff3d9a",
    radius: 15,
    modelScale: 1,
    anim: "Walking",
    animSpeed: 1,
    baseHp: 10,
    baseSpeed: 62,
    touchDamage: 8,
    xp: 3,
    unlockAt: 0,
    weight: 10,
  },
  fast: {
    kind: "fast",
    color: "#ff9d3d",
    radius: 12,
    modelScale: 0.8,
    anim: "Running",
    animSpeed: 1.3,
    baseHp: 6,
    baseSpeed: 128,
    touchDamage: 6,
    xp: 4,
    unlockAt: 35,
    weight: 7,
  },
  tank: {
    kind: "tank",
    color: "#b26bff",
    radius: 26,
    modelScale: 1.7,
    anim: "Walking",
    animSpeed: 0.6,
    baseHp: 55,
    baseSpeed: 42,
    touchDamage: 16,
    xp: 10,
    unlockAt: 75,
    weight: 4,
  },
  splitter: {
    kind: "splitter",
    color: "#ffe24d",
    radius: 20,
    modelScale: 1.1,
    anim: "Running",
    animSpeed: 0.9,
    baseHp: 26,
    baseSpeed: 58,
    touchDamage: 10,
    xp: 6,
    unlockAt: 110,
    weight: 4,
    splitInto: "fast",
  },
  shooter: {
    kind: "shooter",
    color: "#ff5a5a",
    radius: 16,
    modelScale: 1,
    anim: "Walking",
    animSpeed: 0.85,
    baseHp: 18,
    baseSpeed: 40,
    touchDamage: 8,
    xp: 8,
    unlockAt: 150,
    weight: 5,
    shooter: { range: 520, cooldown: 2.2, bulletSpeed: 240, bulletDmg: 10 },
  },
};

export const BOSS: EnemyDef = {
  kind: "boss",
  color: "#ffdd88",
  radius: 64,
  modelScale: 3.2,
  anim: "Walking",
  animSpeed: 0.5,
  baseHp: 900,
  baseSpeed: 46,
  touchDamage: 26,
  xp: 250,
  unlockAt: 0,
  weight: 0,
  shooter: { range: 900, cooldown: 1.4, bulletSpeed: 200, bulletDmg: 14 },
};

export const DIRECTOR = {
  /** Seconds between the escalating "phase" bumps. */
  baseSpawnInterval: 1.1, // seconds between spawn ticks at t=0
  minSpawnInterval: 0.32,
  spawnRampSeconds: 300, // interval reaches min around here
  /** Enemy stat scaling with time. */
  hpScalePerMin: 0.55, // +55% hp per minute
  speedScalePerMin: 0.08,
  batchBase: 1,
  batchGrowthSeconds: 70, // batch size grows by 1 every this many seconds
  bossEverySeconds: 120,
  // Each enemy is now a skinned, animated GLB robot rather than a flat neon
  // polygon — capped lower than the 2D build so hundreds of simultaneous
  // skeleton updates don't tank the frame rate. Fewer, denser robots still
  // reads as a swarm thanks to lighting/bloom.
  maxEnemies: 140,
};

export const PLAYER = {
  radius: 16,
  baseHp: 100,
  baseSpeed: 210,
  basePickupRadius: 130,
  iFrames: 0.7, // invulnerability after a hit
  baseRegen: 0, // hp/sec, raised by upgrades
};

/** XP required to go from level n to n+1. */
export const xpForLevel = (level: number): number =>
  Math.floor(5 + level * 6 + level * level * 1.4);
