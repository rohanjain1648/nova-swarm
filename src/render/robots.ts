/**
 * Loads the CC0 "RobotExpressive" GLB once and hands out independent,
 * animated instances of it.
 *
 * Cloning a skinned character in three.js can't use `Object3D.clone()` — that
 * shares the skeleton across every clone, so all instances would strike the
 * same pose. `SkeletonUtils.clone` deep-clones the bone hierarchy correctly.
 * Materials, however, ARE shared by that clone (same GPU program, cheap) —
 * we only clone the single "Main" material per instance so each robot can be
 * tinted its own color without affecting the others.
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

export type ClipName =
  | "Idle" | "Walking" | "Running" | "Punch" | "Death" | "Jump"
  | "Dance" | "Wave" | "ThumbsUp" | "Yes" | "No" | "Sitting" | "Standing" | "WalkJump";

export interface RobotHandle {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  /** Crossfade to a clip; safe to call every frame with the same name (no-op if already playing). */
  play(name: ClipName, fade?: number): void;
  setTint(hex: number): void;
  setSpeed(mul: number): void;
  update(dt: number): void;
  dispose(): void;
}

export class RobotFactory {
  private gltf: GLTF | null = null;
  private loadPromise: Promise<void> | null = null;

  load(url: string, onProgress?: (frac: number) => void): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    const loader = new GLTFLoader();
    this.loadPromise = new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          this.gltf = gltf;
          resolve();
        },
        (evt) => {
          if (onProgress) onProgress(evt.total > 0 ? evt.loaded / evt.total : 0.5);
        },
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    });
    return this.loadPromise;
  }

  get ready(): boolean {
    return this.gltf !== null;
  }

  /** Natural (unscaled) standing height of the source model, for scale calibration. */
  get naturalHeight(): number {
    if (!this.gltf) return 1;
    const box = new THREE.Box3().setFromObject(this.gltf.scene);
    return box.max.y - box.min.y || 1;
  }

  create(): RobotHandle {
    if (!this.gltf) throw new Error("RobotFactory.create() called before load() resolved");
    const source = this.gltf.scene;
    const root = cloneSkeleton(source) as THREE.Object3D;

    // Clone only the tintable "Main" material per instance; Grey/Black stay shared.
    let tintMaterial: THREE.MeshStandardMaterial | null = null;
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat && mat.name === "Main") {
        if (!tintMaterial) tintMaterial = mat.clone();
        mesh.material = tintMaterial;
      }
    });

    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of this.gltf.animations) {
      actions.set(clip.name, mixer.clipAction(clip));
    }
    // Death is a one-shot pose (game-over flourish), not a looping walk cycle.
    const death = actions.get("Death");
    if (death) {
      death.setLoop(THREE.LoopOnce, 1);
      death.clampWhenFinished = true;
    }

    let current: THREE.AnimationAction | null = null;
    let currentName: string | null = null;

    const handle: RobotHandle = {
      root,
      mixer,
      play(name, fade = 0.25) {
        if (currentName === name) return;
        const next = actions.get(name);
        if (!next) return;
        next.reset().fadeIn(fade).play();
        if (current) current.fadeOut(fade);
        current = next;
        currentName = name;
      },
      setTint(hex) {
        if (tintMaterial) (tintMaterial as THREE.MeshStandardMaterial).color.setHex(hex);
      },
      setSpeed(mul) {
        if (current) current.timeScale = mul;
      },
      update(dt) {
        mixer.update(dt);
      },
      dispose() {
        mixer.stopAllAction();
        if (tintMaterial) (tintMaterial as THREE.MeshStandardMaterial).dispose();
      },
    };
    return handle;
  }
}
