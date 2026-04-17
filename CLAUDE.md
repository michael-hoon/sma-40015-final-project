# CGH Hospital Robot ABM Simulation

## Project Overview

This is an **Agent-Based Model (ABM)** simulating the feasibility of incorporating service robots alongside nurses in a hospital ward, modelled on the Emergency Department at **Changi General Hospital (CGH), Singapore**. The simulation compares two scenarios — **Nurses Only** vs **Nurses + Robots** — to measure whether robots improve patient outcomes by offloading non-clinical tasks and freeing nurses for emergencies.

This is an undergraduate course project for "Simulation Modelling and Analysis". The full simulation specification is in `docs/SIMULATION_SPEC.md`. **Read that file before writing any simulation logic.**

---

## Tech Stack

| Layer | Library | Purpose |
|-------|---------|---------|
| Simulation canvas | **Pixi.js** | WebGL-accelerated 2D rendering of ward grid, agent sprites, health bars, movement |
| Charts & metrics | **Chart.js** | Real-time KPI dashboards (wait times, utilisation, health distributions) |
| UI reactivity | **Alpine.js** | Control panel bindings (sliders, toggles, scenario selectors) — no build step |
| Styling | **Tailwind CSS (CDN)** | Utility-first CSS via CDN link, no build tooling |
| Simulation engine | **Vanilla JS (ES modules)** | Custom tick scheduler, agent classes, spatial grid, pathfinding |
| No build tools | — | No npm, no bundlers, no webpack. All libraries loaded via CDN `<script>` tags or ES module imports from CDN (e.g. esm.sh, cdn.jsdelivr.net). ES modules require a local HTTP server (e.g. `python -m http.server 8080`) — the browser will not load them over `file://`. |

### CDN Sources

```html
<!-- Pixi.js -->
<script src="https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.js"></script>

<!-- Chart.js -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>

<!-- Alpine.js -->
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>

<!-- Tailwind CSS (CDN play version) -->
<script src="https://cdn.tailwindcss.com"></script>
```

---

## Project Structure

```
sma-40015-final-project/
├── CLAUDE.md                  # This file — project rules for Claude Code
├── README.md                  # Details about the project
├── index.html                 # Single-page app entry point
├── docs/
│   └── SIMULATION_SPEC.md     # Full simulation specification (READ FIRST)
├── src/
│   ├── config.js              # All tunable parameters (centralised)
│   ├── simulation/
│   │   ├── Scheduler.js       # Tick loop, pause/resume, speed control
│   │   ├── Grid.js            # Ward grid, cell types, pathfinding
│   │   ├── Agent.js           # Base agent class
│   │   ├── Patient.js         # Patient agent (health bar, need generation)
│   │   ├── Nurse.js           # Nurse agent (scoring, decision-making, movement)
│   │   ├── RobotMEDi.js       # MEDi robot (medication transport, capacity 4 vials)
│   │   ├── RobotBLANKi.js     # BLANKi robot (comfort items, capacity 15 blankets)
│   │   ├── RobotEDi.js        # EDi robot (visitor escort — no item capacity)
│   │   ├── NeedQueue.js       # Global need registry (patients post needs here)
│   │   └── Stats.js           # KPI collection per tick and per replication
│   ├── rendering/
│   │   ├── Renderer.js        # Pixi.js application setup, render loop
│   │   ├── AgentSprites.js    # Sprite creation and animation for each agent type
│   │   ├── GridRenderer.js    # Ward layout rendering (cells, corridors, beds)
│   │   ├── HealthBarRenderer.js # Patient health bar overlays
│   │   └── ChartManager.js    # Chart.js dashboard setup and real-time updates
│   └── ui/
│       ├── ControlPanel.js    # Alpine.js data bindings for simulation controls
│       └── ScenarioManager.js # Switch between Nurses Only / Nurses + Robots
├── assets/
│   └── sprites/               # Agent sprite images (or generated shapes)
└── experiments/
    └── results/               # CSV output from batch experiment runs
```

### Key Principles

- **One file, one concern.** Each agent type gets its own file. Rendering is separate from simulation logic.
- **`config.js` is the single source of truth** for all tunable parameters. Agent classes read from config, never hardcode values.
- **Simulation logic must be completely decoupled from rendering.** The simulation must be able to run "headless" (no Pixi.js, no DOM) for batch experiments. The `Scheduler` drives the simulation; the `Renderer` observes it.
- **ES modules** (`import`/`export`) for all JS files. No CommonJS, no global variables, no inline scripts in HTML.

---

## Coding Standards

### JavaScript
- ES2022+ syntax. Use `class`, `const`/`let` (never `var`), arrow functions, optional chaining, nullish coalescing.
- All files use ES module syntax (`export default class`, `import { X } from`).
- JSDoc comments on every class and public method. Include `@param` and `@returns`.
- Use a **seeded PRNG** (not `Math.random()`). Implement a simple Linear Congruential Generator or use a library. Every stochastic decision must go through the seeded RNG so results are reproducible.
- No `console.log` in committed code except in a dedicated `DEBUG` mode flag.

### Naming
- Classes: `PascalCase` (e.g. `RobotMEDi`, `NeedQueue`)
- Files: `PascalCase.js` matching the class name
- Variables/functions: `camelCase`
- Constants/config keys: `SCREAMING_SNAKE_CASE` (e.g. `TICK_DURATION_MS`, `NURSE_COUNT`)
- Event names: `kebab-case` (e.g. `need-generated`, `agent-arrived`)

### Architecture Rules
- **No circular imports.** If two modules need each other, extract the shared dependency into a third module.
- **No DOM manipulation in simulation files.** Only files inside `rendering/` and `ui/` may touch the DOM.
- **Agent state machines** must use an explicit `this.state` string property with a `switch` statement or state-handler map. No implicit state tracking via boolean flags.
- **Pathfinding** uses Manhattan distance on the grid. If performance requires it, implement A* — but start with BFS.

---

## Simulation Rules (Quick Reference)

> Full details in `docs/SIMULATION_SPEC.md`. These are the essentials for coding.

### Tick Execution Order (STRICT — do not reorder)
1. **Patients** generate new needs (stochastic, based on per-type spawn rates)
2. **Robots** scan NeedQueue, select nearest matching need, claim it; robots with empty inventory go to NURSE_STATION to refill instead
3. **Nurses** scan NeedQueue (unclaimed + emergency-only), score by `urgency × wait_time / distance`, claim highest-scoring; nurses skip needs requiring items they don't carry; nurses with empty inventory slots and no serviceable need go to NURSE_STATION to refill
4. **All agents move** toward their target (grid-based movement). Each agent type advances at a speed set by `config.MOVEMENT_TICKS_PER_CELL` — nurses default to 1 tick/cell, robots default to 2 ticks/cell (half speed). An agent whose internal cooldown is still running stays in place this tick. Visitor_escort handlers (nurses and EDi) go to ENTRANCE first, then to patient.
5. **Task execution** — agents at their target perform the task (decrement service time or refill timer)
6. **State transitions** — completed tasks/refills free the agent; patients with fulfilled needs recover health; battery drain/charge for robots
7. **Health drain** — all patients with unfulfilled needs lose health (rate depends on need urgency)
8. **Stats collection** — record KPIs for this tick

### Core Constraint
**Emergencies can ONLY be handled by nurses.** Robots never claim emergency needs. This is the fundamental reason robots add value — they offload non-emergency tasks, freeing nurse capacity for emergencies.

### Scenarios
- **Scenario A — Nurses Only:** N nurses, 0 robots. All needs handled by nurses.
- **Scenario B — Nurses + Robots:** Same N nurses + configurable fleet of MEDi, BLANKi, EDi robots.

Compare on: mean wait time, critical incident rate (health = 0), nurse utilisation, emergency response time.

---

## What NOT To Do

- **Do not use npm, node_modules, or any build step.** The project runs from `index.html` opened directly in a browser.
- **Do not put simulation parameters as magic numbers in code.** Everything tunable goes in `config.js`.
- **Do not couple rendering to simulation.** A headless run (no browser, no Pixi) must be possible by importing only `src/simulation/` files.
- **Do not use `Math.random()` directly.** Always use the seeded PRNG.
- **Do not skip the tick execution order.** The 8-step order defined above prevents race conditions and is a core requirement.
- **Do not create React, Vue, or Svelte components.** The UI layer is Alpine.js with Tailwind CSS, using vanilla DOM attributes (`x-data`, `x-on:click`, `@click`).

---

## Working Approach

1. **Read `docs/SIMULATION_SPEC.md` first** whenever starting a new feature or making changes to agent behaviour.
2. **Build simulation logic first, rendering second.** Get agents moving and making decisions correctly in the console before adding any Pixi.js rendering.
3. **Test determinism early.** Two runs with the same seed must produce identical KPI outputs. If they don't, there's a bug.
4. **Keep config.js up to date.** When adding a new parameter, add it to config.js with a comment explaining its role and sensible default.
5. When in doubt about a design decision, **refer back to the tick execution order and the core constraint** (emergencies = nurses only).
