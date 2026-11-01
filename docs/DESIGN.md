# NOVA SWARM — Design & Architecture

This document explains _how_ the game is built and _why_ the key decisions were made. It's aimed at a reviewer who wants to understand the engineering and the design under the hood.

## Design pillars

1. **One input, deep decisions.** You only steer. Depth comes from positioning and from the build you assemble at level-ups — not from execution-heavy aiming. This keeps it approachable on mobile and readable at a glance.
2. **Readability under chaos.** Hundreds of entities, but the palette assigns one hue per enemy archetype, the player is the only cyan thing, and XP is the only green. You can parse the screen instantly.
3. **Juice sells the fantasy.** Screen shake, hit-flashes, knockback, particle bursts, a full-screen damage flash, a low-HP vignette, and floating crit numbers make every kill feel good.
4. **The "one more run" loop.** Fast level-ups early, escalating pressure, a boss beat every two minutes, and a saved best time.

## Architecture

The codebase splits into a reusable **engine core**, a **pure simulation** (`game/`), a **3D renderer** (`render/`), and a thin **2D UI overlay** (`ui/`). The key architectural decision — made when the project pivoted from 2D canvas to real-time 3D partway through the build — is that `game/World` knows *nothing* about how it's drawn. It exposes plain pooled-array data (enemy positions, bullet positions, HP, XP, timers) and a couple of renderer-agnostic hooks (`setViewRadius`, `consumeTrauma`), and a separate `WorldView` class syncs that data onto Three.js objects every frame. That separation is what made the pivot a rendering-layer swap rather than a rewrite: every physics, spawn-director, and balance line survived untouched.

```
core/    math (+ seeded RNG) · loop · input · audio          — renderer-agnostic
game/    config · types · world (pure sim) · player · enemies · upgrades · particles
render/  scene (lights/bloom/ground) · camera3d · robots (GLTF+animation) · fx (instanced VFX) · worldView (sync)
ui/      hud · screens · labels3d (3D→2D text projection)     — 2D canvas overlay
main.ts  wiring: dual-canvas setup, asset preload, state machine, loop
```

### Two-canvas layering

The page stacks two `<canvas>` elements: `#scene` (WebGL, driven by Three.js) underneath, `#hud` (2D context, fully transparent except where it draws) on top. Crisp UI text and bars are much simpler in a 2D context than via `TextGeometry` or a UI library — so the HUD, title, level-up cards, and pause/game-over screens stayed on canvas 2D exactly as in the original 2D build, just repainted every frame on top of the live 3D scene instead of being the entire picture.

### Simulation model — fixed timestep

`core/loop.ts` runs a **fixed-timestep accumulator** (60 Hz sim) with a render callback that receives an interpolation `alpha`. Benefits:

- Physics, spawning, and balance are **frame-rate independent** and deterministic.
- Rendering still runs at the display's refresh rate.
- A 0.25 s frame clamp prevents the "spiral of death" when a tab is backgrounded (and the game auto-pauses on `visibilitychange`).

### Collision — uniform spatial hash

Naive collision is `O(bullets × enemies)` and dies under load. `core/grid.ts` buckets enemies into a uniform grid rebuilt each step (clear + re-insert is cheap). Bullets, orbitals, the nova, and the player only test the handful of enemies in nearby cells. This is what lets the game hold hundreds of enemies at 60 fps.

### Rendering — real-time 3D, animated robots, selective bloom

`render/robots.ts` loads a single CC0 animated robot GLB once and hands out independent instances via `SkeletonUtils.clone` (a plain `Object3D.clone()` would share one skeleton across every clone — everyone would strike the same pose). Each instance gets its own cloned "Main" material so it can be tinted per-entity (player cyan, five enemy tints, boss gold) without a full material-per-mesh cost. `render/worldView.ts` walks `World`'s pooled arrays every frame and syncs position/rotation/scale/tint/animation-clip onto these instances — enemies pick their animation clip and playback speed from their tier definition (e.g. tanks get a slow heavy "Walking" stomp, "fast" enemies get a sped-up "Running").

Bullets, gems, and hit-particles are **instanced meshes** (`render/fx.ts`) — one draw call per effect type regardless of how many are alive, with dead pool slots scaled to zero rather than removed. `EffectComposer` + `UnrealBloomPass` add a selective glow (threshold-tuned so emissive VFX bloom while lit robot materials stay clean), and a single moving directional light plus two slow-orbiting colored point lights carry the neon-at-night atmosphere.

### Memory — object pooling

Every transient entity (enemies, bullets, enemy bullets, gems, particles, floating text) lives in a **pooled array** with a `dead` flag. Spawning reuses dead slots; nothing is allocated in the hot loop after warm-up, so there's no GC stutter during long runs. Particles are capped (340, sized to match the 3D renderer's instanced-mesh pool capacity) and recycle oldest-first; the enemy cap is similarly lower than the old 2D build (140 vs. 520) since each one is now a skinned, animated mesh rather than a flat polygon.

### Difficulty — a spawn director

`game/enemies.ts` holds a `Director` that owns spawn cadence and boss timing, decoupled from the `World` via a callback (no import cycle). Over time: the spawn interval shrinks, batch size grows, enemy HP/speed scale, and new archetypes unlock (fast @35s, tank @75s, splitter @110s, shooter @150s). The **Warden** boss spawns every 120 s and showers XP + a heal on death.

### Weapons as stat-driven systems

The player is a flat **stats bag**; upgrades just mutate fields (`damageMul`, `fireRateMul`, `projectileCount`, `pierceBonus`, weapon levels, …). Weapons read derived getters, so the upgrade system is fully decoupled from weapon internals:

- **Blaster** — spawns pooled bullets aimed at the nearest enemy; crits roll per shot.
- **Orbitals** — continuous contact damage sampled from the grid around rotating points.
- **Nova** — periodic AoE from a grid query, with knockback and an expanding ring VFX.

## A real rendering bug, found by systematic elimination

Midway through building the 3D renderer, gems and hit-particles rendered as solid black shapes despite clearly correct positions and sizes. The instinct is to guess (wrong fog density? wrong tone mapping? wrong material flag?) — instead the agent eliminated causes one at a time:

1. **Phantom instances first.** `THREE.InstancedMesh` defaults every unused capacity slot to a *visible* identity matrix at the origin, not hidden — so unused pool slots beyond the live entity count were rendering as extra black dots. Fixed by pre-hiding the full capacity at construction. This was real but didn't fully explain it.
2. **Read the actual GPU-bound buffer.** Rather than keep guessing, a temporary debug hook exposed the live `InstancedMesh.instanceColor.array` to the browser console. It showed **correct, non-black color data** (`0.27, 1.0, 0.10` — bright green) at the exact indices that were visibly rendering black. The data pipeline was fine; the bug was in rendering, not game logic.
3. **Bisect the pipeline.** A one-line debug flag swapped `composer.render()` for a direct `renderer.render(scene, camera)`, ruling out the bloom/post-processing chain — still black.
4. **Compare against a known-good control.** A separate non-instanced `MeshBasicMaterial` mesh (the pickup-radius ring) rendered its solid color correctly in the same frame — isolating the bug specifically to `InstancedMesh.instanceColor`, not `MeshBasicMaterial` or the renderer config in general.

With the bug fully isolated (rather than "fixed" by superstition), the pragmatic call was to stop depending on a code path that reliably failed in this environment: gems, bullets, and particles moved to small pools of **fixed-material-color** `InstancedMesh`es (one pool per color needed) instead of one pool with per-instance `instanceColor`. Same draw-call economics, zero dependency on the broken mechanism, verified working via a fresh screenshot pass.

## A real balance bug, found by playtesting

The most instructive moment of the build: an automated headless playthrough reported **32 kills but only level 2 at 47 seconds** — leveling had effectively stalled. Root cause: the blaster kills grunts at long range, so their XP gems drop far from the player and are never collected. The fix was a **gentle global gem-magnet** (every gem streams toward you, snapping in hard inside the pickup radius), which restored the intended pacing (level 4 by ~55 s) and, as a bonus, reads as a satisfying "vacuum" effect. This is documented in [`AI_WORKFLOW.md`](AI_WORKFLOW.md).

## Balance knobs

All tunables live in [`../src/game/config.ts`](../src/game/config.ts): enemy definitions, difficulty scaling, player base stats, and the XP curve `xpForLevel(n)`. Balance can be re-tuned without touching systems code.

## Accessibility & platform notes

- **Input-agnostic:** keyboard, mouse-drag, and touch all resolve to one normalized movement vector with a virtual analogue stick on touch.
- **DPR-aware** HUD canvas capped at 2× for fill-rate on high-density phones; the WebGL canvas is separately capped at 1.75×.
- **Mute** persists in `localStorage`; audio only starts after a user gesture (autoplay-policy safe).
- **Color + size + motion:** each archetype is a distinct hue, a distinct scale, and a distinct animation/speed, so it doesn't rely on color alone.
