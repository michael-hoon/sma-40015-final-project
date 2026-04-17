# Simulation Specification — CGH Hospital Robot ABM

This document is the **authoritative reference** for all simulation logic. If code contradicts this spec, the code is wrong.

---

## 1. Problem

Changi General Hospital (CGH) in Singapore operates 80+ robots campus-wide. In July 2023, CGH deployed three autonomous mobile robots (AMRs) in its Emergency Department: **MEDi** (medication transport), **BLANKi** (comfort items — blankets, water), and **EDi** (visitor escort). This simulation models whether adding these robots to a hospital ward improves patient outcomes compared to a nurses-only staffing model.

### Research Question

> Does deploying MEDi, BLANKi, and EDi robots alongside nurses reduce patient wait times, lower critical incident rates, and improve emergency response times compared to a nurses-only ward?

### Comparison Scenarios

| Scenario | Staffing |
|----------|----------|
| **A — Nurses Only** | N nurses, 0 robots |
| **B — Nurses + Robots** | N nurses + configurable fleet of MEDi, BLANKi, EDi |

Same patient load, same ward layout, same random seed. Only difference is robot presence.

---

## 2. Ward Layout (Spatial Grid)

The ward is a **2D grid** representing a simplified hospital ward floor plan.

### Cell Types

| Cell Type | Symbol | Description |
|-----------|--------|-------------|
| `CORRIDOR` | `.` | Walkable. Agents move through corridors. |
| `BED` | `B` | Patient location. One patient per bed. Patients do not move. |
| `NURSE_STATION` | `N` | Nurse starting position and idle return point. |
| `CHARGING_BAY` | `C` | Robot charging station. Located at ward periphery. |
| `ENTRANCE` | `E` | Visitor spawn point. EDi escorts visitors from here. |
| `WALL` | `#` | Impassable. |

### Grid Dimensions

- 48 beds arranged in rows along corridors (4 bed rows × 12 beds per row in the default layout)
- 4 nurse stations (centrally located for fast response)
- 3 charging bays (along edges, out of main corridors)
- 1 entrance

### Layout Design Principles

- All beds must be reachable from nurse stations via corridors (no dead ends trapping agents)
- Charging bays should be at the ward periphery (robots travelling to charge shouldn't block main traffic)
- Nurse stations should be central to minimise average distance to beds
- The layout must be defined as a 2D array in config, making it easy to swap in a different ward design

### Pathfinding

- **Manhattan distance** for distance calculations and scoring
- **BFS** for actual pathfinding (find shortest walkable route from agent to target)
- Agents advance along their path at a per-agent-type speed defined by `config.MOVEMENT_TICKS_PER_CELL`. Default values: nurses and patients = 1 tick/cell; MEDi, BLANKi, and EDi robots = 2 ticks/cell (half the nurse speed, reflecting their slower physical motion). Each agent carries an internal cooldown that gates the next cell advance.
- **Multiple agents can occupy the same corridor cell** (no collision blocking — this is a simplification to avoid deadlocks)
- Agents **cannot walk through walls or beds** (only corridor, nurse station, charging bay, entrance cells are walkable)

---

## 3. Agent Definitions

### 3.1 Patient Agent

Patients are **stationary** — they occupy a bed and do not move. They are primarily need-generators and health-trackers.

#### State: Patients have no state machine — they are always "in bed"

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | int | Unique identifier |
| `position` | {x, y} | Bed cell coordinates (fixed) |
| `health` | float | 0–100. Starts at 100. |
| `needs` | array | Currently active (unfulfilled) needs |
| `needsHistory` | array | All needs ever generated (for stats) |

#### Health Mechanics

- Health **drains per tick** for each active (unfulfilled) need:
  - Emergency: **−1.0 / tick**
  - Medication: **−0.3 / tick**
  - Comfort: **−0.1 / tick**
  - Visitor Escort: **−0.05 / tick**
- Health **recovers** when a need is fulfilled: **+25 per fulfilled need** (capped at 100)
- **Critical incident** occurs when health reaches **0**. The patient's health is reset to 50 (representing emergency intervention) and the incident is logged. This is a primary failure metric.
- Multiple active needs stack their drain rates

#### Need Generation

Each tick, a patient has a probability of generating each need type (checked independently):

| Need Type | Spawn Probability Per Tick | Urgency Weight |
|-----------|---------------------------|----------------|
| Emergency | 0.00005 (rare but critical) | 10 |
| Medication | 0.002 | 5 |
| Comfort | 0.005 | 2 |
| Visitor Escort | 0.0015 | 1 |

- A patient can have **multiple simultaneous needs** (e.g. a comfort need and a medication need at the same time)
- A patient **cannot have two of the same need type** active simultaneously
- Each need gets a `createdAtTick` timestamp used for wait time calculation

---

### 3.2 Nurse Agent

Nurses are the **primary caregivers**. They can handle ALL need types, including emergencies (which robots cannot).

#### States

```
IDLE → MOVING_TO_PATIENT → SERVING → IDLE
IDLE → MOVING_TO_ENTRANCE → MOVING_TO_PATIENT → SERVING → IDLE  (visitor_escort only)
IDLE → MOVING_TO_REFILL → REFILLING → IDLE  (when inventory has empty slots and no serviceable need)
```

| State | Description |
|-------|-------------|
| `IDLE` | Scanning NeedQueue for next task |
| `MOVING_TO_ENTRANCE` | Navigating to ENTRANCE cell to collect the visitor (visitor_escort needs only) |
| `MOVING_TO_PATIENT` | Navigating grid toward target patient's bed |
| `SERVING` | At patient's bed, performing task (countdown timer) |
| `MOVING_TO_REFILL` | Navigating to nearest NURSE_STATION to restock inventory |
| `REFILLING` | At NURSE_STATION, waiting for timed restock to complete |

#### Item Inventory

Nurses carry **physical items** (medicine vials and blankets). Each service that requires an item consumes one from the nurse's inventory:

- `medication` needs consume one medicine vial
- `comfort` needs consume one blanket
- `emergency` and `visitor_escort` needs consume no items

**Capacity:** `NURSE_ITEM_CAPACITY = 2` items total (medicine + blankets combined). Allocation between types is **demand-driven**: when a nurse arrives at the refill station, it checks the current NeedQueue and splits slots proportionally between open medication and comfort demands (at least 1 of each type if both have demand).

If a nurse has 0 medicine vials, it skips medication needs. If it has 0 blankets, it skips comfort needs. When idle with empty slots and no serviceable need remaining, it goes to refill.

#### Decision Logic (runs when IDLE)

1. Query NeedQueue for all unclaimed needs
2. **Skip** needs that require items the nurse cannot currently carry (medication → needs ≥1 medicine vial; comfort → needs ≥1 blanket)
3. Score each remaining need: **`score = urgency_weight × wait_ticks / manhattan_distance`**
   - `urgency_weight` = need type's urgency value (Emergency=10, Medication=5, etc.)
   - `wait_ticks` = `current_tick - need.createdAtTick`
   - `manhattan_distance` = distance from nurse's current position to patient's bed (minimum 1 to avoid division by zero)
4. Select the **highest scoring** need
5. **Claim** the need; if `visitor_escort`, navigate to nearest **ENTRANCE** first; otherwise navigate directly to patient
6. If no serviceable need exists and inventory has empty slots, navigate to nearest **NURSE_STATION** to refill

#### Service Times (ticks)

| Need Type | Service Duration |
|-----------|-----------------|
| Emergency | 8–12 ticks (random, seeded) |
| Medication | 4–6 ticks |
| Comfort | 2–3 ticks |
| Visitor Escort | 3–5 ticks |

After serving, nurse returns to `IDLE` at their current position (does not walk back to nurse station — immediately re-scans for next task).

---

### 3.3 Robot Agents

All robots share a base state machine with battery mechanics. Each type serves specific need types only.

#### Shared Robot State Machine

MEDi and BLANKi (item-carrying robots):

```
IDLE → MOVING_TO_PATIENT → SERVING → IDLE
  │                                     │
  ├──── MOVING_TO_REFILL → REFILLING ───┤  (inventory depleted)
  │                                     │
  └──── MOVING_TO_CHARGER → CHARGING ───┘  (battery low)
```

| State | Description |
|-------|-------------|
| `IDLE` | At current position, scanning NeedQueue for matching needs |
| `MOVING_TO_PATIENT` | Navigating to target patient |
| `SERVING` | Performing task at patient's bed (consumes one item from inventory) |
| `MOVING_TO_REFILL` | Inventory depleted; navigating to nearest NURSE_STATION to restock |
| `REFILLING` | At NURSE_STATION; waiting for timed restock to complete |
| `MOVING_TO_CHARGER` | Battery low, navigating to nearest available charging bay |
| `CHARGING` | At charging bay, recharging (cannot serve during this time) |

#### Battery Mechanics

| Parameter | Value |
|-----------|-------|
| Max battery | 100 |
| Drain per tick (while moving) | 0.5 |
| Drain per tick (while serving or refilling) | 0.1 |
| Drain per tick (while idle) | 0.1 |
| Low battery threshold | 20 (triggers move to charger) |
| Charge rate per tick | 2.0 |
| Full charge | 100 (resume IDLE) |

- When battery drops below threshold, robot **abandons current task** (unclaims the need, returns it to NeedQueue), transitions to `MOVING_TO_CHARGER`
- Robot selects the **nearest** charging bay

#### Decision Logic (runs when IDLE, battery ≥ threshold)

1. If **inventory is depleted** (item count = 0), navigate to nearest NURSE_STATION to refill
2. Otherwise query NeedQueue for unclaimed needs **matching this robot's served types**
3. Select the **nearest** matching need (by Manhattan distance)
4. Claim the need
5. Transition to `MOVING_TO_PATIENT`

#### Robot Type Specifics

| Robot | Serves Need Types | Service Time (ticks) | Fleet Size (default) | Inventory | Refill Station |
|-------|-------------------|---------------------|---------------------|-----------|----------------|
| **MEDi** | Medication | 3–4 | 2 | 4 medicine vials (`MEDI_ITEM_CAPACITY`) | Nearest NURSE_STATION |
| **BLANKi** | Comfort | 1–2 | 2 | 15 blankets (`BLANKI_ITEM_CAPACITY`) | Nearest NURSE_STATION |
| **EDi** | Visitor Escort | Instant (0) — hand-off only | 2 | None (no physical items carried) | N/A |

#### MEDi / BLANKi Inventory & Refilling

- Each task consumes one item (one medicine vial for MEDi, one blanket for BLANKi)
- When `itemCount === 0`, the robot enters `MOVING_TO_REFILL` on its next decision tick
- Refill time is calculated as: `itemCapacity × REFILL_TIME_PER_ITEM` ticks total
- Inventory is fully restored (back to capacity) when `REFILLING` completes
- If battery drops below threshold during `MOVING_TO_REFILL` or `REFILLING`, the robot aborts the refill and goes to charge instead

#### EDi Special State

```
IDLE → MOVING_TO_ENTRANCE → MOVING_TO_PATIENT → SERVING → IDLE
  │                                                         │
  └──── MOVING_TO_CHARGER → CHARGING ──────────────────────┘
```

- When EDi claims a Visitor Escort need, it first moves to the **ENTRANCE** cell to "pick up" the visitor, then moves to the patient's bed
- Upon reaching the patient's bed, EDi performs an **instant hand-off** (no service-time countdown) and transitions immediately to `IDLE`. There is no ACCOMPANYING phase — EDi is released right away and becomes available for the next job. The `SERVICE_TIME.robot.visitor_escort` config entry exists for symmetry with MEDi/BLANKi but is ignored by EDi.
- EDi carries no physical items and has no refilling mechanic

---

## 4. NeedQueue (Global Need Registry)

The NeedQueue is the central coordination mechanism. It is **not** a dispatcher — agents independently scan it and claim needs. This emergent coordination is what makes this an ABM.

### Need Object

```javascript
{
  id: int,
  type: 'emergency' | 'medication' | 'comfort' | 'visitor_escort',
  patientId: int,
  position: {x, y},       // patient's bed location
  urgencyWeight: int,      // 10, 5, 2, or 1
  createdAtTick: int,
  claimedBy: null | agentId,
  status: 'open' | 'claimed' | 'in_progress' | 'fulfilled'
}
```

### Rules

- Patients **post** needs to NeedQueue when generated
- Agents **claim** needs (set `claimedBy` to their ID, status to `claimed`)
- If an agent abandons a task (e.g. robot low battery), the need is **unclaimed** (status back to `open`, `claimedBy` back to `null`)
- When an agent completes service, the need is marked `fulfilled` and removed from active queue
- **Emergency needs are invisible to robots** — robots' query filters them out

---

## 5. Tick Execution Order

Each simulation tick represents **30 seconds of real time** (configurable). Ticks execute in this strict order:

| Step | Phase | Description |
|------|-------|-------------|
| 1 | **Need Generation** | Each patient rolls for new needs (per-type probability check) |
| 2 | **Robot Decisions** | All IDLE robots with sufficient battery: if inventory depleted → go to NURSE_STATION; otherwise scan NeedQueue, claim nearest matching need |
| 3 | **Nurse Decisions** | All IDLE nurses: skip needs requiring items not in inventory; score unclaimed needs, claim highest-scoring; if no serviceable need and inventory has empty slots → go to NURSE_STATION to refill |
| 4 | **Movement** | All agents in a MOVING state advance one cell along their BFS path; visitor_escort handlers (nurses and EDi) route via ENTRANCE before the patient's bed |
| 5 | **Task Execution** | Agents in SERVING or REFILLING state decrement their respective countdown timers |
| 6 | **State Transitions** | Completed tasks/refills → agent returns to IDLE; fulfilled needs → patient health recovery; battery updates for robots |
| 7 | **Health Drain** | All patients with active unfulfilled needs lose health (rate by need type) |
| 8 | **Stats Collection** | Record KPIs for this tick (see Section 6) |

### Why This Order Matters

- Robots decide **before** nurses so that in Scenario B, robots claim non-emergency needs first, leaving nurses free for emergencies
- Health drain happens **after** task execution so that a need fulfilled this tick doesn't also drain health this tick
- Need generation happens **first** so newly generated needs are available for agents to claim in the same tick

---

## 6. Key Performance Indicators (KPIs)

### Per-Tick Metrics (collected every tick)

| Metric | Description |
|--------|-------------|
| `activeNeedCount` | Number of open + claimed (not yet fulfilled) needs |
| `nurseUtilisation` | % of nurses in SERVING or MOVING state (not IDLE) |
| `robotUtilisation` | % of robots in SERVING or MOVING state (not IDLE or CHARGING) |
| `averagePatientHealth` | Mean health across all patients |
| `lowestPatientHealth` | Minimum health value (early warning) |

### Per-Replication Metrics (aggregated at end of run)

| Metric | Description |
|--------|-------------|
| `meanWaitTime` | Average ticks from need creation to service start (by need type) |
| `criticalIncidentCount` | Number of times any patient's health hit 0 |
| `meanEmergencyResponseTime` | Average ticks from emergency creation to nurse arrival |
| `totalNeedsGenerated` | Count by type |
| `totalNeedsFulfilled` | Count by type |
| `needsUnfulfilledAtEnd` | Count of needs still open/claimed when simulation ends |
| `meanNurseUtilisation` | Average nurse utilisation across all ticks |
| `meanRobotUtilisation` | Average robot utilisation across all ticks |

### Experiment Design

- **Simulation length:** 960 ticks per run (configurable) — represents one full 8-hour nursing shift (1 tick = 30 s)
- **Warm-up period:** First 50 ticks discarded from statistics (allows the system to reach steady state)
- **Replications:** Minimum 30 runs per scenario (different random seeds) for statistical significance
- **Comparison method:** Welch's t-test on each KPI between Scenario A and Scenario B
- **Random seeds:** Sequential integers (seed 1, 2, 3, ..., 30). Both scenarios use the same seed set.

---

## 7. Default Configuration Values

These are starting defaults. All should be defined in `config.js` and easily adjustable.

```javascript
export const CONFIG = {
  // Grid
  GRID_WIDTH: 20,
  GRID_HEIGHT: 15,

  // Timing
  TICK_DURATION_MS: 200,       // Visual tick speed (rendering only)
  TICKS_PER_RUN: 960,          // 960 ticks × 30s = 8-hour nursing shift
  WARM_UP_TICKS: 50,
  REAL_SECONDS_PER_TICK: 30,   // 1 tick = 30 seconds real time

  // Staffing
  NURSE_COUNT: 4,
  MEDI_COUNT: 2,
  BLANKI_COUNT: 2,
  EDI_COUNT: 2,

  // Patient needs — spawn probability per tick
  NEED_SPAWN_RATE: {
    emergency: 0.00005,
    medication: 0.002,
    comfort: 0.005,
    visitor_escort: 0.0015,
  },

  // Need urgency weights (used in nurse scoring)
  URGENCY_WEIGHT: {
    emergency: 10,
    medication: 5,
    comfort: 2,
    visitor_escort: 1,
  },

  // Health mechanics
  HEALTH_DRAIN_PER_TICK: {
    emergency: 1.0,
    medication: 0.3,
    comfort: 0.1,
    visitor_escort: 0.05,
  },
  HEALTH_RECOVERY_PER_NEED: 25,
  HEALTH_MAX: 100,
  HEALTH_CRITICAL_RESET: 50,

  // Service times [min, max] in ticks
  SERVICE_TIME: {
    nurse: {
      emergency: [8, 12],
      medication: [4, 6],
      comfort: [2, 3],
      visitor_escort: [3, 5],
    },
    robot: {
      medication: [3, 4],     // MEDi
      comfort: [1, 2],        // BLANKi
      visitor_escort: [2, 3], // Present for symmetry; EDi ignores this — hand-off is instant
    },
  },

  // Movement speed — ticks required to traverse one grid cell
  // Higher value = slower. 1 = one cell per tick, 2 = one cell every two ticks.
  MOVEMENT_TICKS_PER_CELL: {
    patient: 1,
    nurse:   1,
    medi:    2,
    blanki:  2,
    edi:     2,
  },

  // Item capacities
  NURSE_ITEM_CAPACITY: 2,    // Total items (medicine + blankets combined)
  MEDI_ITEM_CAPACITY: 4,     // Medicine vials per MEDi load
  BLANKI_ITEM_CAPACITY: 15,  // Blankets per BLANKi load

  // Refilling times at NURSE_STATION
  REFILL_TIME_PER_MEDICINE: 1,  // Ticks to restock one medicine vial
  REFILL_TIME_PER_BLANKET: 1,   // Ticks to restock one blanket

  // Robot battery
  BATTERY_MAX: 100,
  BATTERY_DRAIN_MOVING: 0.5,
  BATTERY_DRAIN_SERVING: 0.1,  // Also applies during REFILLING
  BATTERY_DRAIN_IDLE: 0.1,
  BATTERY_LOW_THRESHOLD: 20,
  BATTERY_CHARGE_RATE: 2.0,

  // Experiment
  REPLICATION_COUNT: 30,
  RANDOM_SEED_START: 1,
};
```

---

## 8. Rendering Requirements

### Simulation Canvas (Pixi.js)

- Ward grid rendered as coloured cells (distinct colours per cell type)
- Each agent type has a distinct visual (colour-coded circle or simple sprite):
  - Patients: white circles at bed positions
  - Nurses: green circles with "N" label
  - MEDi: blue circles with "M" label
  - BLANKi: orange circles with "B" label
  - EDi: purple circles with "E" label
- **Health bars** rendered above each patient (green → yellow → red gradient as health drops)
- **Battery bars** rendered below each robot
- Movement animated smoothly between cells (interpolate position between ticks)
- **Need indicators** on patients: small coloured dots showing active need types
- Visual distinction for claimed vs unclaimed needs (e.g. pulsing vs static dot)

### Charts Panel (Chart.js)

- **Real-time line chart:** Average patient health over ticks
- **Real-time bar chart:** Active need count by type
- **Gauge or number display:** Nurse utilisation %, Robot utilisation %
- **Counter:** Critical incidents so far
- Charts update every tick during visual mode

### Control Panel (Alpine.js)

- Scenario toggle: Nurses Only / Nurses + Robots
- Speed slider: ticks per second (affects `TICK_DURATION_MS`)
- Play / Pause / Step (single tick) / Reset buttons
- Nurse count slider
- Robot fleet size sliders (MEDi, BLANKi, EDi individually)
- Current tick counter display
- Seed input field

---

## 9. Colour Palette Reference

| Element | Hex | Usage |
|---------|-----|-------|
| Corridor | `#f0f0f0` | Walkable floor |
| Wall | `#4a4a4a` | Impassable |
| Bed (empty) | `#e8e8e8` | No patient |
| Bed (occupied) | `#ffffff` | Patient present |
| Nurse station | `#c8e6c9` | Light green |
| Charging bay | `#fff9c4` | Light yellow |
| Entrance | `#bbdefb` | Light blue |
| Nurse agent | `#2e7d32` | Green |
| MEDi robot | `#1565c0` | Blue |
| BLANKi robot | `#ef6c00` | Orange |
| EDi robot | `#7b1fa2` | Purple |
| Patient | `#ffffff` | White with black outline |
| Health high | `#4caf50` | Green |
| Health mid | `#ff9800` | Amber |
| Health low | `#f44336` | Red |
| Need: Emergency | `#f44336` | Red dot |
| Need: Medication | `#2196f3` | Blue dot |
| Need: Comfort | `#ff9800` | Orange dot |
| Need: Visitor Escort | `#9c27b0` | Purple dot |
