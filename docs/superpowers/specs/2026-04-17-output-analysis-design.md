# Output Analysis: Design Spec

**Date:** 2026-04-17
**Project:** CGH Hospital Robot ABM Simulation
**Course:** SMA-40015 Simulation Modelling and Analysis
**Author:** Claude Code + michael-hoon

## Context

The simulation already captures the right raw data — `src/simulation/Stats.js` records all spec-mandated KPIs per-tick and per-replication, `src/simulation/BatchRunner.js` runs 30 seeded replications per scenario headlessly, and `src/analysis/Statistics.js` computes descriptive stats, 95% CIs, and Welch's t-tests that are surfaced in the live dashboard.

What the project lacks is **output analysis** that answers the grading rubric and the research question. The rubric asks for four things: (1) types of analysis the model can support, (2) sensitivity analysis with conclusions, (3) steady-state vs non-steady-state discussion, and (4) accuracy of the sample mean. The research question is external: *are the CGH robots useful for other hospitals* — which cannot be answered from a single fixed-configuration A/B comparison because other hospitals have different staffing and patient loads.

The current A-vs-B t-test also has methodological gaps: it ignores the pairing induced by common seeds (should be paired t, not Welch), it assumes approximate normality for count-type KPIs (critical incidents are zero-inflated), it reports no effect sizes, and it makes no multiple-comparison correction across ≥4 KPIs.

This design fixes the methodology and adds the missing rubric sections by adopting a **hybrid JS + Python workflow**: the JS simulation engine (already headless) is extended to emit raw per-replication data across a parameter sweep, and all statistical analysis and figure generation move to a Python Jupyter notebook. The live browser dashboard is left intact as a demo/debugging surface.

## Goals

1. Produce a report/notebook pair that satisfies each of the four rubric items with defensible methodology.
2. Support a **sensitivity analysis rich enough to answer "does this generalise to other hospitals"** — specifically by sweeping staffing and robot fleet composition, which are the dimensions on which other hospitals differ.
3. Keep the JS code changes minimal and additive; no refactoring of simulation or rendering.
4. Keep the analysis pipeline reproducible: seeds, configs, and git commit hash embedded in every output file.

## Non-Goals

- Re-architecting simulation logic or rendering.
- Adding new KPIs beyond what `Stats.js` already records.
- Building surrogate models / metamodels / Gaussian-process emulators (design option S3 from brainstorm).
- Cost–benefit or ROI analysis (interesting but outside the rubric).
- Modifying the live Alpine/Chart.js dashboard beyond what's needed to trigger the sweep.

## Architecture

Three layers, clearly separated:

```
┌───────────────────────────────────────────┐
│  JS (Browser, headless-capable)           │
│  ─ Scheduler, agents, Stats               │  ← unchanged
│  ─ BatchRunner (minor: runId, CSV emit)   │  ← extended
│  ─ ExperimentRunner.js (new)              │  ← orchestrates factorial + OAT sweep
└───────────────────────────────────────────┘
                  │  emits
                  ▼
         experiments/results/<runId>/
            runs.csv          one row per replication (KPIs + params + seed)
            manifest.json     grid definition, git hash, timestamp
                  │  consumed by
                  ▼
┌───────────────────────────────────────────┐
│  Python (Jupyter notebook)                │
│  ─ pandas / scipy.stats / statsmodels     │
│  ─ matplotlib / seaborn                   │
│  ─ experiments/analysis/output_analysis.ipynb  │
└───────────────────────────────────────────┘
                  │  emits
                  ▼
         experiments/report/
            figures/*.png
            tables/*.md
                  │  consumed by
                  ▼
  OUTPUT_ANALYSIS.md   ← Claude-generated narrative report
```

The JS side runs simulations and emits raw data. Python does *all* statistical analysis. The markdown report is a thin narrative layer over notebook outputs.

## JS-Side Changes

Additive only. All existing code paths continue to work.

### `src/simulation/BatchRunner.js` (modify)

- Accept a new `{runId, paramsTag}` argument alongside existing `configOverrides`.
- After collecting `results`, return them as before **and** additionally call a new `writeResultsCsv(runId, paramsTag, results, cfg)` helper that triggers a browser download (or writes via File System Access API if available).
- Each row in `runs.csv` carries: `runId`, all factor values (nurse, medi, blanki, edi, need_spawn_rate_*, etc.), `seed`, and every flat KPI field from `sched.getStats()` (nested fields like `meanWaitTime.emergency` are flattened to `meanWaitTime_emergency`).
- One `manifest.json` is written per sweep with: `git_hash`, `timestamp_iso`, `base_config`, `grid_definition`, `total_cells`, `total_runs`.

### `src/analysis/ExperimentRunner.js` (new file)

- Public: `async function runSweep({onProgress, writer})`.
- Enumerates the full design grid (factorial + OAT below), calls `BatchRunner.run(...)` for each cell with appropriate `configOverrides`, accumulates rows, emits a single `runs.csv` + `manifest.json` at the end.
- Emits progress callbacks for a new UI button "Run Full Sweep" added to the existing `ExperimentPanel`.
- Rows are accumulated in memory (3,540 rows is trivially small — single-digit MB), and a single Blob download of `runs.csv` + `manifest.json` is triggered when the sweep completes. A "checkpoint every N cells" escape hatch using the File System Access API is deferred as a YAGNI since estimated wall time is under 30 min; if sweeps later grow longer, revisit.

### `src/ui/ExperimentPanel.js` (minor addition)

- New button "Run Full Sweep" next to existing "Run Experiment".
- Alpine binding calls into `ExperimentRunner.runSweep`.
- Progress bar shows `cell X of 118 — replication Y of 30`.
- No change to existing A/B experiment flow.

### `src/analysis/Statistics.js`

**Unchanged.** All advanced stats (paired t, bootstrap CI, Mann-Whitney, Holm-Bonferroni, effect sizes) move to Python.

## Experimental Design

### Factorial (core sweep)

| Factor | Levels | Count |
|---|---|---|
| `NURSE_COUNT` | 3, 5, 7 | 3 |
| `MEDI_COUNT` | 0, 1, 2, 3 | 4 |
| `BLANKI_COUNT` | 0, 1, 2 | 3 |
| `EDI_COUNT` | 0, 1, 2 | 3 |

= **108 cells**. Pure Scenario A baselines appear naturally inside the factorial at `(MEDI=0, BLANKI=0, EDI=0)` for each nurse level — no separate A/B run needed.

### OAT supplement (load parameters, robots fixed at baseline 1/1/1, nurses fixed at 5)

| Factor | Levels | Count |
|---|---|---|
| `NEED_SPAWN_RATE.medication` | 0.5×, 0.75×, 1×, 1.5×, 2× baseline | 5 |
| `NEED_SPAWN_RATE.emergency` | 0.5×, 0.75×, 1×, 1.5×, 2× baseline | 5 |

= **10 additional cells**.

### Replication

- **30 replications per cell**, seeded sequentially 1–30 — matches the spec.
- **Common Random Numbers across cells**: seed *k* at every cell uses the same PRNG stream, so a given seed produces the same patient arrival pattern regardless of staffing. This enables paired analysis across the sweep.

### Totals

118 cells × 30 reps = **3,540 runs**. At ~0.3–0.5 s per headless run, estimated wall time 20–30 min. Acceptable.

## Notebook Structure

One notebook `experiments/analysis/output_analysis.ipynb`, four sections mapped 1:1 to the rubric.

### §1 — Types of analysis

- Descriptive: per-scenario marginal distributions, violin + boxplots, CDF plots for the five primary KPIs.
- Comparative: **paired t-test** on baseline A (`MEDI=BLANKI=EDI=0, NURSE=5`) vs baseline B (`MEDI=BLANKI=EDI=1, NURSE=5`). Report paired mean difference, paired 95% CI, Cohen's *d_z*, and bootstrap 95% CI of the mean difference (10 000 resamples) as a non-parametric cross-check.
- Multiple comparisons: Holm-Bonferroni correction across the primary KPI set.
- Count-KPI handling: for `criticalIncidentCount`, report both a paired t result and a bootstrap CI of the mean difference; if the distribution is heavily zero-inflated (≥50% zeros), report Mann-Whitney U instead.

### §2 — Sensitivity analysis

- **Tornado plot** of standardised main effects from a linear model fit on each KPI against `(NURSE_COUNT, MEDI, BLANKI, EDI)`, using factorial data. Tells reader which knob matters most per KPI.
- **Interaction heatmap** of `meanEmergencyResponseTime` (and separately `criticalIncidentCount`) over the nurse × MEDi grid with BLANKi=EDi=1. This is the centrepiece figure: it shows explicitly where robots add value and where they're redundant.
- **Ridge / facet plot** of wait time across robot fleet sizes, one facet per nurse count.
- **OAT sensitivity curves** of primary KPIs vs `need_spawn_rate_*`.
- Conclusion subsection: at which `(nurse, load)` regimes is each robot type worth deploying.

### §3 — Steady-state vs non-steady-state

- Framing: the ward is a **terminating simulation** — a single 8-hour shift has a defined start and end, discrete shift handovers, and no claim of long-run steady-state. Method-of-independent-replications is the correct methodology (which `BatchRunner` already implements); batch-means / deletion-of-initial-transient is not appropriate here.
- Empirical justification for 50-tick warmup: **Welch's graphical method** — plot cumulative-mean across replications of `averagePatientHealth` and `activeNeedCount` over tick index, with a moving window, and identify where the transient dies. Either confirm 50 is adequate, or recommend a revised value.
- Requires a small subset of runs (say 30 replications of a single baseline config) to export their full `tickHistory`. Minor extension to `BatchRunner`: optional `exportTickHistory: true` flag writes `tick_history.csv` (rep × tick × KPI) for one cell only.

### §4 — Accuracy of the sample mean

For each of the five primary KPIs at the baseline-B configuration:

- Mean, sample SD, 95% CI (t-distribution), CI half-width *h*, relative precision *h / mean*.
- **Required-n calculation**: *n\* = ⌈(t_{α/2, n-1} · s / δ)²⌉* with target absolute precision δ = 10 % of baseline mean. Declare per KPI whether 30 reps meets the precision target.
- **Running-mean convergence plot**: 95% CI half-width vs number of replications (n = 2 … 30), one line per KPI — shows visually whether CIs have stabilised.
- Brief note on coverage probability and the normality assumption for the CI.

## Primary KPI set (for report emphasis)

Ordered by clinical significance:

1. `criticalIncidentCount` — patient safety (health → 0 events).
2. `meanEmergencyResponseTime` — how fast the most urgent needs are reached.
3. `meanWaitTime.emergency` — full wait for an emergency need.
4. `meanWaitTime.medication` — most-frequent clinical need.
5. `meanNurseUtilisation` — workload / burnout proxy.

`meanRobotUtilisation`, comfort/escort wait times, and `needsUnfulfilledAtEnd` are reported in appendix tables only.

## Report Generation

After the notebook runs end-to-end:

- All figures written to `experiments/report/figures/` as 300 DPI PNG.
- All summary tables written to `experiments/report/tables/` as markdown.
- A separate invocation of Claude Code reads the notebook outputs + figures + tables and authors `experiments/report/OUTPUT_ANALYSIS.md`. Report structure: executive summary → method → each rubric section as its own chapter referencing the figures → generalisability discussion → limitations.
- The generalisability chapter is the centrepiece: it uses the interaction heatmap to argue which *types of hospital* (characterised by nurse count and patient load) should invest in each robot type.

## Reproducibility

- Every `runs.csv` row carries its seed and all factor values — any single run is replayable.
- `manifest.json` carries the git hash at sweep time.
- Python notebook pins dependencies in `experiments/analysis/requirements.txt`.
- Seeds are deterministic (1–30 per cell); re-running the sweep produces bit-identical KPI numbers.

## Verification

End-to-end test plan:

1. **Sanity**: run a tiny sweep (2 cells × 3 reps = 6 runs) through the UI, confirm `runs.csv` has 6 rows with correct schema, `manifest.json` has a git hash.
2. **Determinism**: re-run the tiny sweep, diff `runs.csv` — must be identical.
3. **Full sweep**: run all 3,540 runs, confirm wall time is within 20–30 min, confirm `runs.csv` has 3,540 rows.
4. **Notebook**: execute `output_analysis.ipynb` top-to-bottom against the full `runs.csv`, confirm no errors, confirm all four rubric sections produce non-empty figures and tables.
5. **Report**: invoke Claude Code against the notebook outputs, read the generated `OUTPUT_ANALYSIS.md`, confirm each rubric section is present, each figure is referenced, and the generalisability chapter draws a concrete conclusion ("hospitals with N nurses and load ≤ X benefit most from MEDi; BLANKi is marginal below load Y").

## Files Touched

| File | Change |
|---|---|
| `src/simulation/BatchRunner.js` | Add `runId`/`paramsTag` args, CSV writer call, optional tick-history export |
| `src/analysis/ExperimentRunner.js` | **New** — orchestrates factorial + OAT sweep, emits `runs.csv` + `manifest.json` |
| `src/ui/ExperimentPanel.js` | Add "Run Full Sweep" button + progress binding |
| `src/analysis/Statistics.js` | **Unchanged** |
| `experiments/analysis/output_analysis.ipynb` | **New** — four-section analysis notebook |
| `experiments/analysis/requirements.txt` | **New** — pinned Python deps |
| `experiments/report/OUTPUT_ANALYSIS.md` | **New** — generated narrative |
| `experiments/results/<runId>/` | **New** — output directory (gitignored except for one canonical sweep) |
