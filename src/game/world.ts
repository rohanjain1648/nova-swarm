import { SpatialGrid } from "../core/grid";
import { angleTo, clamp, dist, len, RNG, TAU } from "../core/math";
import type { Audio } from "../core/audio";
import type { Input } from "../core/input";
import { PALETTE, WORLD, xpForLevel } from "./config";
import type { EnemyKind } from "./config";
import { Director, initEnemy, ringPoint, shooterConfig } from "./enemies";
import { Particles } from "./particles";
import { Player } from "./player";
import { rollUpgrades, upgradeLabel, type Upgrade } from "./upgrades";
import type { Bullet, Enemy, EnemyBullet, Gem } from "./types";

export interface NovaRing {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  dead: boolean;
}

export interface RunStats {
  time: number;
  kills: number;
  level: number;
}

/**
 * Pure simulation — no rendering, no camera. Owns every entity in pooled
 * arrays and advances the world by one deterministic fixed step in `update`.
 * A separate renderer (see src/render/) reads these arrays each frame; World
 * has no idea whether it's being drawn in 2D or 3D.
 *
 * `traumaPulse` replaces the old camera's built-in shake: World just reports
 * "how much impact happened this step," and whatever camera is in use decides
 * how to turn that into a shake.
 */
export class World {
  readonly particles = new Particles();
  private readonly grid = new SpatialGrid<Enemy>(WORLD.gridCell);
  private readonly rng = new RNG();
  private readonly director = new Director();

  player = new Player();
  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  enemyBullets: EnemyBullet[] = [];
  gems: Gem[] = [];
  readonly novaRings: NovaRing[] = [];

  time = 0;
  kills = 0;
  level = 1;
  xp = 0;
  xpToNext = xpForLevel(1);
  pendingLevelUps = 0;
  gameOver = false;
  private taken: Record<string, number> = {};
  private boss: Enemy | null = null;
  flashT = 0; // full-screen flash intensity (level up / boss / death), read by the HUD overlay
  flashColor = "255,255,255";

  /** Spawn-ring radius around the player; the renderer sets this from its camera's visible extent. */
  private viewRadius = 900;
  private trauma = 0;

  constructor(private readonly audio: Audio) {}

  setViewRadius(r: number): void {
    this.viewRadius = r;
  }

  /** Read + reset the accumulated screen-shake impulse for this frame. */
  consumeTrauma(): number {
    const t = this.trauma;
    this.trauma = 0;
    return t;
  }

  private addTrauma(v: number): void {
    this.trauma = Math.max(this.trauma, v);
  }

  reset(): void {
    this.player.reset();
    for (const e of this.enemies) e.dead = true;
    for (const b of this.bullets) b.dead = true;
    for (const b of this.enemyBullets) b.dead = true;
    for (const g of this.gems) g.dead = true;
    this.novaRings.length = 0;
    this.particles.reset();
    this.director.reset();
    this.time = 0;
    this.kills = 0;
    this.level = 1;
    this.xp = 0;
    this.xpToNext = xpForLevel(1);
    this.pendingLevelUps = 0;
    this.gameOver = false;
    this.taken = {};
    this.boss = null;
    this.flashT = 0;
    this.trauma = 0;
  }

  // ---- Pool helpers -------------------------------------------------------
  private acquireEnemy(): Enemy {
    for (let i = 0; i < this.enemies.length; i++) if (this.enemies[i].dead) return this.enemies[i];
    const e: Enemy = {
      x: 0, y: 0, vx: 0, vy: 0, radius: 10, hp: 1, maxHp: 1, speed: 0,
      touchDamage: 0, xp: 0, kind: "grunt", color: "#fff",
      modelScale: 1, anim: "Idle", animSpeed: 1,
      dead: true, flash: 0, kbx: 0, kby: 0, shootCd: 0,
      isBoss: false, spawnT: 0,
    };
    this.enemies.push(e);
    return e;
  }

  private acquireBullet(): Bullet {
    for (let i = 0; i < this.bullets.length; i++) if (this.bullets[i].dead) return this.bullets[i];
    const b: Bullet = {
      x: 0, y: 0, vx: 0, vy: 0, radius: 5, damage: 0, pierce: 0,
      life: 0, dead: true, crit: false, hitCd: 0,
    };
    this.bullets.push(b);
    return b;
  }

  private acquireEnemyBullet(): EnemyBullet {
    for (let i = 0; i < this.enemyBullets.length; i++) if (this.enemyBullets[i].dead) return this.enemyBullets[i];
    const b: EnemyBullet = { x: 0, y: 0, vx: 0, vy: 0, radius: 7, damage: 0, life: 0, dead: true };
    this.enemyBullets.push(b);
    return b;
  }

  private acquireGem(): Gem {
    for (let i = 0; i < this.gems.length; i++) if (this.gems[i].dead) return this.gems[i];
    const g: Gem = { x: 0, y: 0, vx: 0, vy: 0, radius: 7, value: 0, dead: true, magnet: false, kind: "xp" };
    this.gems.push(g);
    return g;
  }

  private spawnEnemyAt = (kind: EnemyKind, x: number, y: number): void => {
    const e = this.acquireEnemy();
    initEnemy(e, kind, x, y, this.time);
    if (kind === "boss") {
      this.boss = e;
      this.audio.bossWarn();
      this.flash("255,200,90", 0.7);
      this.addTrauma(0.6);
    }
  };

  private aliveEnemyCount(): number {
    let n = 0;
    for (let i = 0; i < this.enemies.length; i++) if (!this.enemies[i].dead) n++;
    return n;
  }

  private flash(color: string, intensity: number): void {
    this.flashColor = color;
    this.flashT = Math.max(this.flashT, intensity);
  }

  // ---- Simulation ---------------------------------------------------------
  update(dt: number, input: Input): void {
    if (this.gameOver) return;
    this.time += dt;
    input.update();

    this.movePlayer(dt, input);
    this.updateEnemies(dt);
    this.grid.rebuild(this.enemies);

    const target = this.grid.nearest(this.player.x, this.player.y, 1400);
    this.player.facing = target ? angleTo(this.player.x, this.player.y, target.x, target.y) : this.player.facing;

    this.fireWeapons(dt, target);
    this.updateBullets(dt);
    this.updateEnemyBullets(dt);
    this.contactDamage();
    this.updateGems(dt);
    this.updateNovaRings(dt);

    // Player timers
    const p = this.player;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.hurtFlash > 0) p.hurtFlash = Math.max(0, p.hurtFlash - dt * 3);
    if (p.regen > 0 && p.hp < p.maxHp) {
      p.regenFrac += p.regen * dt;
      if (p.regenFrac >= 1) {
        const add = Math.floor(p.regenFrac);
        p.hp = Math.min(p.maxHp, p.hp + add);
        p.regenFrac -= add;
      }
    }

    this.particles.update(dt);
    this.director.update(dt, this.time, p.x, p.y, this.viewRadius, this.aliveEnemyCount(), this.rng, this.spawnEnemyAt);
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt * 2.2);

    // Music intensity ramps with time + on-screen pressure.
    this.audio.setIntensity(clamp(this.time / 240 + this.aliveEnemyCount() / 400, 0, 1));

    if (p.hp <= 0) this.die();
  }

  private movePlayer(dt: number, input: Input): void {
    const p = this.player;
    const targetVx = input.move.x * p.speed;
    const targetVy = input.move.y * p.speed;
    // Snappy but not instant — small accel for weightiness.
    p.vx += (targetVx - p.vx) * Math.min(1, dt * 16);
    p.vy += (targetVy - p.vy) * Math.min(1, dt * 16);
    p.x = clamp(p.x + p.vx * dt, -WORLD.half, WORLD.half);
    p.y = clamp(p.y + p.vy * dt, -WORLD.half, WORLD.half);
  }

  private updateEnemies(dt: number): void {
    const p = this.player;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.dead) continue;
      e.spawnT += dt;
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 5);

      const a = angleTo(e.x, e.y, p.x, p.y);
      const spawnBoost = e.spawnT < 0.4 ? 0 : 1; // brief pause as they fade in
      e.vx = Math.cos(a) * e.speed * spawnBoost;
      e.vy = Math.sin(a) * e.speed * spawnBoost;

      // Knockback decays quickly and adds to motion.
      e.kbx *= 1 - Math.min(1, dt * 8);
      e.kby *= 1 - Math.min(1, dt * 8);

      e.x = clamp(e.x + (e.vx + e.kbx) * dt, -WORLD.half, WORLD.half);
      e.y = clamp(e.y + (e.vy + e.kby) * dt, -WORLD.half, WORLD.half);

      // Ranged enemies + boss fire at the player.
      const sc = shooterConfig(e.kind);
      if (sc) {
        e.shootCd -= dt;
        const d = dist(e.x, e.y, p.x, p.y);
        if (e.shootCd <= 0 && d < sc.range) {
          e.shootCd = sc.cooldown;
          if (e.isBoss) {
            // Boss fires a spread.
            for (let k = -2; k <= 2; k++) this.fireEnemyBullet(e, a + k * 0.22, sc.bulletSpeed, sc.bulletDmg);
          } else {
            this.fireEnemyBullet(e, a, sc.bulletSpeed, sc.bulletDmg);
          }
        }
      }
    }
  }

  private fireEnemyBullet(e: Enemy, angle: number, speed: number, dmg: number): void {
    const b = this.acquireEnemyBullet();
    b.x = e.x;
    b.y = e.y;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.radius = 7;
    b.damage = dmg;
    b.life = 5;
    b.dead = false;
  }

  // ---- Weapons ------------------------------------------------------------
  private fireWeapons(dt: number, target: Enemy | null): void {
    const p = this.player;

    // Blaster: aimed volley at nearest enemy.
    p.blasterCd -= dt;
    if (p.blasterCd <= 0 && target) {
      p.blasterCd = p.blasterInterval;
      const n = p.blasterProjectiles;
      const spread = n > 1 ? 0.24 : 0;
      const base = angleTo(p.x, p.y, target.x, target.y);
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) - 0.5 : 0;
        this.fireBullet(base + t * spread * (n - 1) * 0.5 + t * spread);
      }
      this.audio.shoot();
    }

    // Orbitals: continuous contact damage around rotating points.
    if (p.orbital > 0) {
      p.orbitAngle += dt * 2.6;
      const count = p.orbitalCount;
      for (let i = 0; i < count; i++) {
        const a = p.orbitAngle + (i / count) * TAU;
        const ox = p.x + Math.cos(a) * p.orbitalRadius;
        const oy = p.y + Math.sin(a) * p.orbitalRadius;
        this.grid.query(ox, oy, 18 + 30, (e) => {
          if (dist(ox, oy, e.x, e.y) <= 18 + e.radius) {
            this.damageEnemy(e, p.orbitalDamage * dt, false, ox, oy, 0);
          }
        });
      }
    }

    // Nova: periodic shockwave.
    if (p.nova > 0) {
      p.novaCd -= dt;
      if (p.novaCd <= 0) {
        p.novaCd = p.novaInterval;
        const r = p.novaRadius;
        this.novaRings.push({ x: p.x, y: p.y, r: 8, maxR: r, life: 0.45, dead: false });
        this.grid.query(p.x, p.y, r + 40, (e) => {
          const d = dist(p.x, p.y, e.x, e.y);
          if (d <= r + e.radius) {
            const a = angleTo(p.x, p.y, e.x, e.y);
            this.damageEnemy(e, p.novaDamage, false, e.x, e.y, 260);
            e.kbx += Math.cos(a) * 260;
            e.kby += Math.sin(a) * 260;
          }
        });
        this.audio.hit();
        this.addTrauma(0.18);
      }
    }
  }

  private fireBullet(angle: number): void {
    const p = this.player;
    const b = this.acquireBullet();
    const speed = 640 * p.projSpeedMul;
    b.x = p.x + Math.cos(angle) * 18;
    b.y = p.y + Math.sin(angle) * 18;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.radius = 5;
    b.crit = this.rng.chance(p.critChance);
    b.damage = p.blasterDamage * (b.crit ? p.critMul : 1);
    b.pierce = p.pierceBonus;
    b.life = 1.4;
    b.hitCd = 0;
    b.dead = false;
  }

  private updateBullets(dt: number): void {
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      if (b.dead) continue;
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (Math.abs(b.x) > WORLD.half + 40 || Math.abs(b.y) > WORLD.half + 40) { b.dead = true; continue; }
      if (b.hitCd > 0) { b.hitCd -= dt; continue; }

      // Broad-phase query; boss radius (64) is the largest, pad accordingly.
      this.grid.query(b.x, b.y, b.radius + 70, (e) => {
        if (b.dead || b.hitCd > 0) return;
        if (dist(b.x, b.y, e.x, e.y) <= b.radius + e.radius) {
          this.damageEnemy(e, b.damage, b.crit, b.x, b.y, 90);
          b.hitCd = 0.04;
          if (b.pierce <= 0) b.dead = true;
          else b.pierce--;
        }
      });
    }
  }

  private updateEnemyBullets(dt: number): void {
    const p = this.player;
    for (let i = 0; i < this.enemyBullets.length; i++) {
      const b = this.enemyBullets[i];
      if (b.dead) continue;
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (dist(b.x, b.y, p.x, p.y) <= b.radius + p.radius) {
        b.dead = true;
        if (p.takeDamage(b.damage)) this.onPlayerHurt();
      }
    }
  }

  private damageEnemy(e: Enemy, dmg: number, crit: boolean, hx: number, hy: number, knockback: number): void {
    if (e.dead) return;
    e.hp -= dmg;
    e.flash = 1;
    if (knockback > 0) {
      const a = angleTo(this.player.x, this.player.y, e.x, e.y);
      e.kbx += Math.cos(a) * knockback;
      e.kby += Math.sin(a) * knockback;
    }
    this.particles.spark(hx, hy, e.color, crit ? 6 : 2, 200, crit ? 3.5 : 2.2);
    if (crit) this.particles.text(hx, hy - 6, `${Math.round(dmg)}`, "#fff2a8", 20);
    if (e.hp <= 0) this.killEnemy(e);
    else this.audio.hit();
  }

  private killEnemy(e: Enemy): void {
    e.dead = true;
    this.kills++;
    this.particles.spark(e.x, e.y, e.color, e.isBoss ? 60 : 12, e.isBoss ? 460 : 260, e.isBoss ? 5 : 3);

    if (e.isBoss) {
      this.audio.bigKill();
      this.addTrauma(0.8);
      this.flash("255,230,140", 0.8);
      this.boss = null;
      this.director.bossActive = false;
      // Boss showers rewards.
      for (let i = 0; i < 24; i++) {
        const [gx, gy] = ringPoint(e.x, e.y, 20 + Math.random() * 90, this.rng);
        this.dropGem(gx, gy, Math.ceil(e.xp / 24), "xp");
      }
      this.dropGem(e.x, e.y, 0, "heal");
    } else {
      this.audio.kill();
      this.addTrauma(0.08);
      this.dropGem(e.x, e.y, e.xp, "xp");
      if (this.rng.chance(0.02)) this.dropGem(e.x + 12, e.y, 0, "heal");
      // Splitters spawn children on death.
      if (e.splitInto) {
        for (let i = 0; i < 2; i++) {
          const child = this.acquireEnemy();
          initEnemy(child, e.splitInto, e.x + (Math.random() - 0.5) * 24, e.y + (Math.random() - 0.5) * 24, this.time);
        }
      }
    }
  }

  private dropGem(x: number, y: number, value: number, kind: "xp" | "heal"): void {
    const g = this.acquireGem();
    g.x = x;
    g.y = y;
    const a = Math.random() * TAU;
    const s = 40 + Math.random() * 60;
    g.vx = Math.cos(a) * s;
    g.vy = Math.sin(a) * s;
    g.radius = kind === "heal" ? 10 : 7;
    g.value = value;
    g.magnet = false;
    g.kind = kind;
    g.dead = false;
  }

  private contactDamage(): void {
    const p = this.player;
    this.grid.query(p.x, p.y, p.radius + 70, (e) => {
      if (dist(p.x, p.y, e.x, e.y) <= p.radius + e.radius) {
        if (p.takeDamage(e.touchDamage)) {
          this.onPlayerHurt();
          // Small knockback to the enemy so you're not instantly re-hit.
          const a = angleTo(e.x, e.y, p.x, p.y);
          e.kbx -= Math.cos(a) * 160;
          e.kby -= Math.sin(a) * 160;
        }
      }
    });
  }

  private onPlayerHurt(): void {
    this.audio.hurt();
    this.addTrauma(0.5);
    this.flash("255,60,90", 0.45);
    this.particles.spark(this.player.x, this.player.y, PALETTE.danger, 14, 240, 3);
  }

  private updateGems(dt: number): void {
    const p = this.player;
    for (let i = 0; i < this.gems.length; i++) {
      const g = this.gems[i];
      if (g.dead) continue;
      const d = dist(g.x, g.y, p.x, p.y);
      const a = angleTo(g.x, g.y, p.x, p.y);
      // Enemies die at blaster range, far from the player, so a gentle global
      // magnet streams every gem back toward you (great "vacuum" game feel);
      // inside the pickup radius it snaps in fast. Pickup upgrades widen the
      // snap zone and tighten the stream.
      const inRange = d < p.pickupRadius;
      if (inRange) g.magnet = true;
      const pull = g.magnet ? 1400 : 240;
      g.vx += Math.cos(a) * pull * dt;
      g.vy += Math.sin(a) * pull * dt;
      const sp = len(g.vx, g.vy);
      const maxSp = g.magnet ? 1100 : 300;
      if (sp > maxSp) {
        g.vx = (g.vx / sp) * maxSp;
        g.vy = (g.vy / sp) * maxSp;
      }
      g.x += g.vx * dt;
      g.y += g.vy * dt;

      if (d <= p.radius + g.radius) {
        g.dead = true;
        if (g.kind === "heal") {
          p.hp = Math.min(p.maxHp, p.hp + Math.max(15, p.maxHp * 0.15));
          this.particles.text(p.x, p.y - 20, "+HP", PALETTE.heal, 18);
          this.audio.pickup();
        } else {
          this.addXp(g.value);
          this.audio.pickup();
        }
      }
    }
  }

  private addXp(value: number): void {
    this.xp += value * this.player.xpMul;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = xpForLevel(this.level);
      this.pendingLevelUps++;
    }
  }

  private updateNovaRings(dt: number): void {
    for (let i = this.novaRings.length - 1; i >= 0; i--) {
      const n = this.novaRings[i];
      n.life -= dt;
      n.r += (n.maxR - n.r) * Math.min(1, dt * 10);
      if (n.life <= 0) this.novaRings.splice(i, 1);
    }
  }

  private die(): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.player.hp = 0;
    this.audio.bigKill();
    this.addTrauma(1);
    this.flash("255,60,90", 1);
    this.particles.spark(this.player.x, this.player.y, PALETTE.player, 80, 420, 5);
  }

  // ---- Level-up interface (driven by the UI layer) ------------------------
  rollUpgradeChoices(): Upgrade[] {
    return rollUpgrades(this.player, this.taken, this.rng, 3);
  }

  choiceLabel(u: Upgrade): string {
    return upgradeLabel(u, this.player, this.taken);
  }

  applyUpgrade(u: Upgrade): void {
    u.apply(this.player);
    this.taken[u.id] = (this.taken[u.id] ?? 0) + 1;
    this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
    this.audio.levelup();
    this.flash("120,200,255", 0.4);
  }

  get stats(): RunStats {
    return { time: this.time, kills: this.kills, level: this.level };
  }

  get bossHpFraction(): number | null {
    return this.boss && !this.boss.dead ? clamp(this.boss.hp / this.boss.maxHp, 0, 1) : null;
  }
}
