import { BOSS, DIRECTOR, ENEMIES, WORLD } from "./config";
import type { EnemyDef, EnemyKind } from "./config";
import type { Enemy } from "./types";
import { clamp, RNG, TAU } from "../core/math";

/** Multiplicative HP scaling as the run goes on. */
export const hpScale = (t: number): number => 1 + (t / 60) * DIRECTOR.hpScalePerMin;
export const speedScale = (t: number): number =>
  clamp(1 + (t / 60) * DIRECTOR.speedScalePerMin, 1, 1.9);

/** Seconds between spawn ticks, shrinking over the run. */
export const spawnInterval = (t: number): number => {
  const k = clamp(t / DIRECTOR.spawnRampSeconds, 0, 1);
  return DIRECTOR.baseSpawnInterval + (DIRECTOR.minSpawnInterval - DIRECTOR.baseSpawnInterval) * k;
};

/** How many enemies to release per tick, grows slowly with time. */
const batchSize = (t: number): number => DIRECTOR.batchBase + Math.floor(t / DIRECTOR.batchGrowthSeconds);

const defFor = (kind: EnemyKind): EnemyDef =>
  kind === "boss" ? BOSS : ENEMIES[kind as Exclude<EnemyKind, "boss">];

/** Populate a (possibly recycled) enemy struct in place. */
export function initEnemy(e: Enemy, kind: EnemyKind, x: number, y: number, t: number): void {
  const def = defFor(kind);
  const boss = kind === "boss";
  const hs = hpScale(t) * (boss ? 1 + t / 240 : 1);
  const ss = speedScale(t);
  e.kind = kind;
  e.x = x;
  e.y = y;
  e.vx = 0;
  e.vy = 0;
  e.radius = def.radius;
  e.maxHp = Math.round(def.baseHp * hs);
  e.hp = e.maxHp;
  e.speed = def.baseSpeed * ss;
  e.touchDamage = def.touchDamage;
  e.xp = def.xp;
  e.color = def.color;
  e.modelScale = def.modelScale;
  e.anim = def.anim;
  e.animSpeed = def.animSpeed;
  e.dead = false;
  e.flash = 0;
  e.kbx = 0;
  e.kby = 0;
  e.shootCd = def.shooter ? def.shooter.cooldown * (0.5 + Math.random()) : 0;
  e.isBoss = boss;
  e.splitInto = def.splitInto;
  e.spawnT = 0;
}

export const shooterConfig = (kind: EnemyKind) => defFor(kind).shooter;

/** Weighted pick of an unlocked enemy kind for the current run time. */
export function chooseKind(t: number, rng: RNG): EnemyKind {
  let total = 0;
  const eligible: EnemyDef[] = [];
  for (const key of Object.keys(ENEMIES) as Exclude<EnemyKind, "boss">[]) {
    const d = ENEMIES[key];
    if (t >= d.unlockAt) {
      eligible.push(d);
      total += d.weight;
    }
  }
  let r = rng.next() * total;
  for (const d of eligible) {
    r -= d.weight;
    if (r <= 0) return d.kind;
  }
  return "grunt";
}

/**
 * Spawn director: owns spawn cadence + boss timing. Kept free of World
 * references — it calls back into a `spawn` function so there's no import cycle.
 */
export class Director {
  private spawnTimer = spawnInterval(0);
  private bossTimer = DIRECTOR.bossEverySeconds;
  bossPending = false;
  bossActive = false;

  reset(): void {
    this.spawnTimer = spawnInterval(0);
    this.bossTimer = DIRECTOR.bossEverySeconds;
    this.bossPending = false;
    this.bossActive = false;
  }

  update(
    dt: number,
    t: number,
    px: number,
    py: number,
    viewRadius: number,
    enemyCount: number,
    rng: RNG,
    spawn: (kind: EnemyKind, x: number, y: number) => void,
  ): void {
    // Boss cadence
    this.bossTimer -= dt;
    if (this.bossTimer <= 0 && !this.bossActive) {
      this.bossTimer = DIRECTOR.bossEverySeconds;
      const [bx, by] = ringPoint(px, py, viewRadius + 120, rng);
      spawn("boss", bx, by);
      this.bossActive = true;
      this.bossPending = true;
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer += spawnInterval(t);
      if (enemyCount < DIRECTOR.maxEnemies) {
        const n = batchSize(t);
        for (let i = 0; i < n; i++) {
          const kind = chooseKind(t, rng);
          const [x, y] = ringPoint(px, py, viewRadius + 60 + rng.next() * 120, rng);
          spawn(kind, x, y);
        }
      }
    }
  }
}

/** A point on a ring around (px,py), clamped inside the arena. */
export function ringPoint(px: number, py: number, radius: number, rng: RNG): [number, number] {
  const a = rng.next() * TAU;
  const x = clamp(px + Math.cos(a) * radius, -WORLD.half, WORLD.half);
  const y = clamp(py + Math.sin(a) * radius, -WORLD.half, WORLD.half);
  return [x, y];
}
