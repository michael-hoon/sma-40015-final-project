# Output Analysis Scripts

Four scripts produce the figures and tables for the four rubric sections of the
output-analysis report. Reads canonical sweep output from `data/`, writes to
`experiments/report/figures/` and `experiments/report/tables/`.

## Setup (one-off)

```bash
# From the project root
source .venv/bin/activate
uv pip install -r experiments/analysis/requirements.txt
```

## Run

Either individually (easier to iterate on one section at a time):

```bash
python experiments/analysis/analysis_01_types.py
python experiments/analysis/analysis_02_sensitivity.py
python experiments/analysis/analysis_03_steady_state.py
python experiments/analysis/analysis_04_accuracy.py
```

…or all four in order:

```bash
python experiments/analysis/run_all.py
```

## Inputs

Produced by `experiments/run_sweep.mjs`:

- `data/runs.csv` — 3,540 per-replication rows
- `data/manifest.json` — sweep metadata + git hash
- `data/tick_history.csv` — 28,800 per-tick rows for the baseline-B cell

## Outputs

### Figures (300 DPI PNG, `experiments/report/figures/`)

| File | Section |
|---|---|
| `01_descriptive_boxplot_cdf.png` | §1 |
| `02_tornado_main_effects.png` | §2 |
| `02_interaction_heatmap.png` | §2 |
| `02_waittime_vs_fleet.png` | §2 |
| `02_oat_curves.png` | §2 |
| `03_welch_graphical.png` | §3 |
| `04_running_mean.png` | §4 |

### Tables (GitHub-flavour markdown, `experiments/report/tables/`)

| File | Section |
|---|---|
| `01_descriptive.md` | §1 |
| `01_paired_comparison.md` | §1 |
| `02_main_effects.md` | §2 |
| `03_warmup.md` | §3 |
| `04_accuracy.md` | §4 |
| `04_normality.md` | §4 |
