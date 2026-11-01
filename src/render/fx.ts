/**
 * Instanced glow effects: bullets, gems, and hit-spark particles. Each pool
 * is a single THREE.InstancedMesh sized generously up front — dead pool
 * slots are just scaled to zero rather than removed, which keeps this at one
 * draw call per pool regardless of how many are alive.
 *
 * Each pool has ONE fixed material color rather than per-instance tinting.
 * (Per-instance `instanceColor` reliably rendered solid black in testing —
 * a rendering quirk in this Three.js/SwiftShader combination that fixed-
 * color pools sidestep entirely, at the cost of a few more draw calls.)
 * Materials use `toneMapped: false` so these stay vivid and feed the bloom pass.
 */
import * as THREE from "three";

export class InstancerPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private readonly dummy = new THREE.Object3D();

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number) {
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) this.hide(i);
    this.finish();
  }

  set(i: number, x: number, y: number, z: number, scale: number): void {
    if (i >= this.capacity) return; // pools are sized generously; silently drop rare overflow
    this.dummy.position.set(x, y, z);
    this.dummy.scale.setScalar(scale);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
  }

  hide(i: number): void {
    if (i >= this.capacity) return;
    this.dummy.position.set(0, -5000, 0);
    this.dummy.scale.setScalar(0);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
  }

  /** Hide every slot from `start` to capacity — for pools reassigned fresh each frame. */
  hideFrom(start: number): void {
    for (let i = start; i < this.capacity; i++) this.hide(i);
  }

  finish(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const glowMat = (color: number) => new THREE.MeshBasicMaterial({ color, toneMapped: false });

export interface FxPools {
  bullets: InstancerPool;
  enemyBullets: InstancerPool;
  gemsXp: InstancerPool;
  gemsHeal: InstancerPool;
  sparks: InstancerPool;
  hurtSparks: InstancerPool;
}

export function createFxPools(scene: THREE.Scene, palette: { bullet: number; enemyBullet: number; xp: number; heal: number; danger: number }): FxPools {
  const bullets = new InstancerPool(new THREE.SphereGeometry(1, 8, 8), glowMat(palette.bullet), 400);
  const enemyBullets = new InstancerPool(new THREE.OctahedronGeometry(1, 0), glowMat(palette.enemyBullet), 200);
  const gemsXp = new InstancerPool(new THREE.OctahedronGeometry(1, 0), glowMat(palette.xp), 260);
  const gemsHeal = new InstancerPool(new THREE.OctahedronGeometry(1, 0), glowMat(palette.heal), 40);
  const sparks = new InstancerPool(new THREE.SphereGeometry(1, 5, 4), glowMat(0xfff2c9), 280);
  const hurtSparks = new InstancerPool(new THREE.SphereGeometry(1, 5, 4), glowMat(palette.danger), 60);

  scene.add(bullets.mesh, enemyBullets.mesh, gemsXp.mesh, gemsHeal.mesh, sparks.mesh, hurtSparks.mesh);
  return { bullets, enemyBullets, gemsXp, gemsHeal, sparks, hurtSparks };
}

/** A small pool of individually-materialed ring meshes for the nova shockwave (few concurrent, needs real opacity fade). */
export class RingPool {
  private readonly rings: THREE.Mesh[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene, private readonly color: number, capacity = 4) {
    for (let i = 0; i < capacity; i++) {
      const geo = new THREE.TorusGeometry(1, 0.06, 8, 48);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, toneMapped: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push(mesh);
    }
  }

  sync(active: { x: number; y: number; r: number; life: number }[]): void {
    for (const m of this.rings) m.visible = false;
    for (let i = 0; i < active.length && i < this.rings.length; i++) {
      const ring = active[i];
      const mesh = this.rings[(this.cursor + i) % this.rings.length];
      mesh.visible = true;
      mesh.position.set(ring.x, 22, ring.y);
      mesh.scale.setScalar(Math.max(0.05, ring.r));
      (mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.85, ring.life * 2);
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(this.color);
    }
  }
}
