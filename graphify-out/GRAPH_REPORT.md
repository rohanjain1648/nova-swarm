# Graph Report - .  (2026-07-11)

## Corpus Check
- Corpus is ~37,323 words - fits in a single context window. You may not need a graph.

## Summary
- 400 nodes · 730 edges · 25 communities (16 shown, 9 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Math & RNG Utilities
- Main Entry & Game-State Handlers
- World Simulation & Entities
- VFX & Robot Rendering
- Design & AI-Workflow Narrative
- Procedural Audio Engine
- TypeScript Config
- Package & Dependencies
- Input Handling
- Gameplay Screenshot HUD
- Particles & Float-Text
- Level-Up Screen UI
- Spatial Grid
- Game Loop
- 3D Scene Setup
- Title Screen UI
- Instanced-Mesh Pool
- Vercel Deploy Config
- Favicon Iconography
- Dual-Canvas Entry
- Loop & State-Machine Design
- Smoke Test
- Camera & Screen Shake

## God Nodes (most connected - your core abstractions)
1. `World` - 47 edges
2. `Audio` - 23 edges
3. `Input` - 20 edges
4. `clamp()` - 20 edges
5. `compilerOptions` - 19 edges
6. `Player` - 17 edges
7. `RNG` - 13 edges
8. `drawTitle()` - 13 edges
9. `Enemy` - 11 edges
10. `render()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `NOVA SWARM (project)` --references--> `Deploy to GitHub Pages Workflow`  [EXTRACTED]
  README.md → .github/workflows/deploy.yml
- `NOVA SWARM (project)` --references--> `Plan → Implement → Verify → Fix Loop`  [EXTRACTED]
  README.md → docs/AI_WORKFLOW.md
- `NOVA SWARM (project)` --references--> `NOVA SWARM Design & Architecture`  [EXTRACTED]
  README.md → docs/DESIGN.md
- `Module Split (core/game/render/ui)` --conceptually_related_to--> `Renderer-agnostic World / WorldView boundary`  [EXTRACTED]
  docs/DESIGN.md → README.md
- `Renderer-agnostic World / WorldView boundary` --rationale_for--> `Mid-build 2D → 3D Pivot`  [EXTRACTED]
  README.md → docs/AI_WORKFLOW.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Renderer-agnostic Boundary Enabling 2D→3D Pivot** — readme_renderer_agnostic_world, docs_ai_workflow_3d_pivot, docs_design_module_architecture, readme_object_pooling [INFERRED 0.85]
- **InstancedMesh Black-render Bug Hunt & Fix** — docs_ai_workflow_rendering_bug_hunt, docs_design_fixed_color_pools, readme_instanced_vfx [EXTRACTED 1.00]
- **Verify-driven Build Loop (test → bug → fix)** — docs_ai_workflow_agentic_loop, docs_ai_workflow_browser_verification, docs_ai_workflow_gem_magnet_fix, readme_playwright_smoke_test [EXTRACTED 1.00]

## Communities (25 total, 9 thin omitted)

### Community 0 - "Math & RNG Utilities"
Cohesion: 0.05
Nodes (34): clamp(), damp(), dist2(), len(), lerp(), RNG, Vec2, BOSS (+26 more)

### Community 1 - "Main Entry & Game-State Handlers"
Cohesion: 0.08
Nodes (54): app, audio, best, choices, drawLoading(), drawScreenFlash(), finishRun(), followCamera (+46 more)

### Community 2 - "World Simulation & Entities"
Cohesion: 0.13
Nodes (8): angleTo(), dist(), xpForLevel(), Bullet, Enemy, EnemyBullet, Gem, World

### Community 3 - "VFX & Robot Rendering"
Cohesion: 0.09
Nodes (12): createFxPools(), FxPools, glowMat(), RingPool, ClipName, RobotFactory, RobotHandle, FloatLabel (+4 more)

### Community 4 - "Design & AI-Workflow Narrative"
Cohesion: 0.09
Nodes (30): Mid-build 2D → 3D Pivot, Plan → Implement → Verify → Fix Loop, Real-browser Verification via Playwright, XP-pacing Stall & Gem-magnet Fix, InstancedMesh Black-render Bug Hunt, Balance Knobs in config.ts, Fixed-material-color Instanced Pools (bug workaround), Module Split (core/game/render/ui) (+22 more)

### Community 6 - "TypeScript Config"
Cohesion: 0.10
Nodes (20): compilerOptions, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch (+12 more)

### Community 7 - "Package & Dependencies"
Cohesion: 0.11
Nodes (18): dependencies, three, description, devDependencies, playwright, @types/three, typescript, vite (+10 more)

### Community 9 - "Gameplay Screenshot HUD"
Cohesion: 0.23
Nodes (12): Attack Radius Circle, Enemy Robot Waves, Health Bar, Heads-Up Display (HUD), Kill Counter (55 killed), Level Indicator (LV 5), ESC Pause Control, Player Robot Character (+4 more)

### Community 10 - "Particles & Float-Text"
Cohesion: 0.29
Nodes (4): RobotAnim, Particles, FloatText, Particle

### Community 11 - "Level-Up Screen UI"
Cohesion: 0.22
Nodes (10): Player Health Bar, Game HUD Overlay, Numeric Keyboard Selection, Neon Dark Sci-Fi Theme, Orbital Shards Weapon, Rapid Coils Upgrade, Reinforced Hull Upgrade, Level Up Screen (+2 more)

### Community 13 - "Game Loop"
Cohesion: 0.25
Nodes (3): GameLoop, RenderFn, UpdateFn

### Community 15 - "Title Screen UI"
Cohesion: 0.43
Nodes (7): Nova Swarm Game Logo, Controls Instructions, Sound Mute Toggle, Dark Neon Visual Theme, Play Button, Nova Swarm Title Screen, Tagline: Outlast the neon swarm

### Community 17 - "Vercel Deploy Config"
Cohesion: 0.33
Nodes (5): buildCommand, cleanUrls, framework, outputDirectory, $schema

### Community 18 - "Favicon Iconography"
Cohesion: 1.00
Nodes (3): Enemy Swarm, Favicon (Space Shooter Icon), Player Ship

## Knowledge Gaps
- **81 isolated node(s):** `name`, `private`, `version`, `type`, `description` (+76 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `World` connect `World Simulation & Entities` to `Math & RNG Utilities`, `Main Entry & Game-State Handlers`, `VFX & Robot Rendering`, `Procedural Audio Engine`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Why does `Audio` connect `Procedural Audio Engine` to `Math & RNG Utilities`, `Main Entry & Game-State Handlers`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `Input` connect `Input Handling` to `Math & RNG Utilities`, `Main Entry & Game-State Handlers`, `World Simulation & Entities`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _86 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Math & RNG Utilities` be split into smaller, more focused modules?**
  _Cohesion score 0.053208137715179966 - nodes in this community are weakly interconnected._
- **Should `Main Entry & Game-State Handlers` be split into smaller, more focused modules?**
  _Cohesion score 0.07597895967270601 - nodes in this community are weakly interconnected._
- **Should `World Simulation & Entities` be split into smaller, more focused modules?**
  _Cohesion score 0.12802275960170698 - nodes in this community are weakly interconnected._