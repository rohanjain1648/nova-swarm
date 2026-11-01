/**
 * Scene dressing: renderer, lights, ground/grid, fog, and a selective-bloom
 * post pipeline. Kept separate from gameplay so `World` never touches Three.js.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { WORLD } from "../game/config";

export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly sunTarget = new THREE.Object3D();
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(0x05060a);
    this.scene.fog = new THREE.FogExp2(0x05060a, 0.00035);

    this.camera = new THREE.PerspectiveCamera(52, 16 / 9, 1, 6000);

    // Ambient + a single moving "sun" that casts the only real-time shadow
    // (kept tight around the player so a modest shadow map stays sharp).
    this.scene.add(new THREE.AmbientLight(0x8fb0ff, 0.55));
    const hemi = new THREE.HemisphereLight(0x6fa8ff, 0x0a0510, 0.5);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xbfd8ff, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1536, 1536);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 1600;
    const s = 480;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0015;
    this.sun.target = this.sunTarget;
    this.scene.add(this.sun, this.sunTarget);

    // Two slow-orbiting neon rim lights for atmosphere (cheap: only 2 extra lights).
    this.scene.add(this.makeRimLight(0xff2d8a, 900));
    this.scene.add(this.makeRimLight(0x2de1ff, 900));

    this.buildGround();

    // Post: selective bloom — threshold tuned so only emissive/bright bits
    // (bullets, gems, robot eyes, the arena boundary) bloom, not the whole scene.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.5, 0.72);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  private rimClock = 0;
  private rimLights: { light: THREE.PointLight; radius: number; speed: number; phase: number }[] = [];

  private makeRimLight(color: number, radius: number): THREE.PointLight {
    const light = new THREE.PointLight(color, 6, 1400, 2);
    light.position.set(radius, 140, 0);
    this.rimLights.push({ light, radius, speed: 0.12 + Math.random() * 0.05, phase: Math.random() * Math.PI * 2 });
    return light;
  }

  private buildGround(): void {
    const size = WORLD.half * 2.6;
    // Emissive-tinted rather than purely lit: guarantees the floor stays
    // visible regardless of shadow-map/light tuning, which matters a lot
    // here since it's the backdrop for the entire game.
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x141a2c,
      emissive: 0x0b0f1e,
      emissiveIntensity: 0.8,
      roughness: 0.95,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = false;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(WORLD.half * 2, Math.round((WORLD.half * 2) / WORLD.bgGrid), 0x4a9bff, 0x1c3358);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    grid.position.y = 0.5;
    this.scene.add(grid);

    // Glowing arena boundary ring.
    const ringGeo = new THREE.TorusGeometry(WORLD.half, 6, 8, 128);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x5a8cff });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 4;
    this.scene.add(ring);

    // Low outer wall so the arena reads as a contained space from the orbit camera.
    const wallGeo = new THREE.CylinderGeometry(WORLD.half + 4, WORLD.half + 4, 90, 64, 1, true);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x0a1024,
      emissive: 0x14274a,
      emissiveIntensity: 0.4,
      side: THREE.BackSide,
      roughness: 1,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = 45;
    this.scene.add(wall);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.renderer.setPixelRatio(dpr);
  }

  /** Keep the shadow-casting sun locked to a fixed offset above the player. */
  followSun(px: number, py: number): void {
    this.sun.position.set(px + 220, 420, py + 180);
    this.sunTarget.position.set(px, 0, py);
  }

  updateAtmosphere(dt: number, px: number, py: number): void {
    this.rimClock += dt;
    for (const r of this.rimLights) {
      const a = this.rimClock * r.speed + r.phase;
      r.light.position.set(px + Math.cos(a) * r.radius, 160 + Math.sin(a * 1.3) * 60, py + Math.sin(a) * r.radius);
    }
  }

  render(): void {
    this.composer.render();
  }
}
