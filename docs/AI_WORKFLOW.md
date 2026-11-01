# AI Workflow

NOVA SWARM was built in an **agentic workflow** with **Claude Code** (Anthropic's CLI; model Claude Sonnet 5) acting as a senior pair-engineer under human direction. This document is an honest account of how the AI was used to plan, build, debug, verify, and balance the game — one of the Parsewave judging criteria.

## The loop we used

Rather than one-shot prompting, the build ran as a tight **plan → implement → verify → fix** loop:

### 1. Scope & architecture
The agent was asked to architect a game to win the jam. It:
- Presented four concrete, winnable concepts with trade-offs and a recommendation; the human chose **Neon Wave Survivor**.
- Chose the stack (**TypeScript + Vite + Canvas 2D**, no game framework) with explicit reasoning tied to the judging criteria (readable code, easy deploy, high performance ceiling).
- Laid out a module split (`core` engine vs. `game` vs. `ui`) before writing code.

### 2. Implementation
The agent wrote the codebase module by module — engine core first (loop, input, camera, spatial grid, sprite cache, audio), then game systems (world, player, enemies + director, weapons, upgrades, particles), then the UI and the state-machine wiring. Strict TypeScript caught mistakes at build time; a few `noUnusedLocals`/type errors were surfaced by `tsc` and fixed immediately.

### 3. Verification in a real browser — not just "it compiles"
This is the part that mattered most. The agent didn't stop at a green build. It:
- Started the production preview server and drove the **actual game** headlessly with **Playwright** (Chromium).
- Captured screenshots of the title, HUD, gameplay, and the level-up screen and **looked at them** to confirm the neon rendering, layout, and UI were correct.
- Ran extended 40–55 second sessions asserting **zero console/page errors** while spawning hundreds of enemies, applying dozens of upgrades, and unlocking weapons.

### 4. A balance bug found by playtesting, then fixed
The highest-value catch of the whole build:

> An instrumented playthrough logged **32 kills but only level 2 at t=47s** — leveling had stalled.

The agent diagnosed the root cause (the long-range blaster kills enemies far from the player, so their XP gems are stranded and never collected), and fixed it with a **global gem-magnet**: gems gently stream toward the player and snap in hard inside the pickup radius. Re-running the same test showed pacing restored (**level 4 by ~55s**) and the change doubled as a satisfying "vacuum" game-feel improvement. A small opt-in debug probe (`?debug`) was added so the automated test could read exact run state.

### 5. Mid-build pivot: 2D canvas → real-time 3D
Partway through, the human asked for something more "real" — 3D, animated GLB robots, a more engaging ecosystem. Rather than bolt 3D onto the 2D code, the agent:
- Asked one focused clarifying question (top-down follow camera vs. third-person chase vs. cinematic auto-camera) since it materially changed engineering risk, rather than guessing or over-asking about things it could decide itself.
- Verified sandbox internet access, then sourced a real **CC0-licensed** animated robot model (`RobotExpressive.glb`, by Tomás Laulhé / Don McCurdy) from the three.js examples repository — checking its actual license text before committing to it, and inspecting its GLB binary directly (a small Node script parsing the GLB JSON chunk) to confirm its animation clips and materials before writing any loading code.
- Re-architected `World` to be renderer-agnostic (see [`DESIGN.md`](DESIGN.md)) so the entire simulation — physics, spawn director, upgrades, XP curve, balance — carried over into the 3D build **completely unchanged**. Only the rendering layer was replaced.
- Built the Three.js pipeline: GLTF skeletal-animation instancing, instanced-mesh VFX pools, bloom post-processing, dynamic lighting, and a top-down follow camera.

### 6. A rendering bug, root-caused rather than guessed at
Gems and hit-particles rendered solid black despite correct positions. Instead of trying random fixes, the agent worked through a systematic elimination: confirmed the phantom-instance issue with `InstancedMesh` default matrices, then — when that didn't fully explain it — added a temporary debug hook to read the **actual GPU-bound color buffer** live from the browser (proving the data was correct: bright green, not black), then bisected the render pipeline by bypassing bloom/post-processing entirely, then compared against a known-good non-instanced control mesh in the same frame. That narrowed the bug to exactly one mechanism (`InstancedMesh.instanceColor`), at which point the fix was a deliberate design change (fixed-color instanced pools) rather than a guess. Full account in [`DESIGN.md`](DESIGN.md#a-real-rendering-bug-found-by-systematic-elimination).

### 7. Hardening & delivery
The throwaway test scripts were promoted into a single self-hosted **smoke test** (`npm run smoke`) that boots the build, waits for the 3D asset to load, plays, and fails CI-style on any runtime error or if leveling breaks. Then docs, deploy config, and an incremental git history.

## What the AI did vs. didn't do

- **Did:** all planning, all TypeScript, the entire 3D scene/lighting/effects pipeline, all procedural audio code, sourcing and license-verifying the one external asset, the test harness, debugging, balancing, and docs.
- **Didn't:** use any AI asset-generation tool (no AI-generated images, 3D models, or audio). The one non-original asset is a pre-existing, human-made, CC0-licensed robot model — sourced and disclosed, not generated. Every sound is procedural, generated **in code at runtime**.

## Traces

The submission includes `ai-traces.zip` containing the full agent transcript (prompts, the agent's reasoning summaries, tool calls, and command/build logs) from the build session. To regenerate a build log locally:

```bash
npm ci > ../ai-traces/install.log 2>&1
npm run build > ../ai-traces/build.log 2>&1
npm run smoke > ../ai-traces/smoke.log 2>&1
```

The commit history (`git log`) is itself a trace of the incremental, verify-as-you-go process described above.
