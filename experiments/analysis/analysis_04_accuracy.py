"""§4 — Accuracy of the sample mean.

For each primary KPI at baseline-B we report mean, SD, 95% CI (t-distribution),
half-width, and relative precision. We also compute the required replication
count n* for ±10% absolute precision and plot CI half-width convergence as
replications accumulate.

Produces:
- 04_accuracy.md        — precision table with required-n verdict per KPI
- 04_normality.md       — Shapiro-Wilk test per KPI (validity of the t-CI)
- 04_running_mean.png   — running mean ± 95% CI as N grows from 2 to 30
"""
from __future__ import annotations

from math import ceil

import numpy as np
import pandas as pd
import scipy.stats as stats
import matplotlib.pyplot as plt

from common import (
    apply_style, load_runs, PRIMARY_KPIS, KPI_LABELS,
    ci_t, write_table, save_figure,
)


RELATIVE_PRECISION_TARGET = 0.10  # ±10% of the baseline mean


def accuracy_table(base_b: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for kpi in PRIMARY_KPIS:
        sample = base_b[kpi].values
        stats_obj = ci_t(sample)
        m = stats_obj['mean']
        s = stats_obj['std']
        delta = RELATIVE_PRECISION_TARGET * abs(m) if m != 0 else float('nan')
        if m != 0 and np.isfinite(stats_obj['t_crit']) and s > 0:
            n_req = int(ceil((stats_obj['t_crit'] * s / delta) ** 2))
        else:
            n_req = float('nan')
        rel = stats_obj['half_width'] / abs(m) if m != 0 else float('nan')
        rows.append({
            'KPI':                KPI_LABELS[kpi],
            'n':                  stats_obj['n'],
            'mean':               m,
            'std':                s,
            'CI95_low':           stats_obj['ci_low'],
            'CI95_high':          stats_obj['ci_high'],
            'half_width':         stats_obj['half_width'],
            'rel_precision':      rel,
            'n_required_10pct':   n_req,
            'adequate':           'YES' if np.isfinite(n_req) and stats_obj['n'] >= n_req else 'NO',
        })
    return pd.DataFrame(rows)


def running_mean_figure(base_b: pd.DataFrame) -> plt.Figure:
    n_kpi = len(PRIMARY_KPIS)
    fig, axes = plt.subplots(1, n_kpi, figsize=(4 * n_kpi, 3.5), constrained_layout=True)
    sorted_b = base_b.sort_values('seed')
    for ax, kpi in zip(axes, PRIMARY_KPIS):
        vals = sorted_b[kpi].values
        n_arr = np.arange(1, len(vals) + 1)
        running_mean = np.cumsum(vals) / n_arr
        # Running std: vectorised via cumulative sums of x and x^2
        cum_x  = np.cumsum(vals)
        cum_x2 = np.cumsum(vals ** 2)
        var = np.where(
            n_arr > 1,
            (cum_x2 - (cum_x ** 2) / n_arr) / np.maximum(n_arr - 1, 1),
            0.0,
        )
        var = np.clip(var, 0, None)
        running_std = np.sqrt(var)
        with np.errstate(divide='ignore', invalid='ignore'):
            t_crit = stats.t.ppf(0.975, np.maximum(n_arr - 1, 1))
            half_w = t_crit * running_std / np.sqrt(n_arr)
        ax.plot(n_arr, running_mean, color='#0D9488', lw=2, label='Running mean')
        ax.fill_between(
            n_arr,
            running_mean - half_w,
            running_mean + half_w,
            alpha=0.25, color='#0D9488', label='95% CI',
        )
        ax.set_title(KPI_LABELS[kpi], fontsize=10)
        ax.set_xlabel('Number of replications')
        ax.set_ylabel('Mean')
        ax.legend(fontsize=8)
    fig.suptitle('§4 — Running mean ± 95% CI vs replication count (baseline-B)', fontsize=12)
    return fig


def normality_table(base_b: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for kpi in PRIMARY_KPIS:
        vals = base_b[kpi].values
        if np.std(vals) == 0:
            rows.append({
                'KPI': KPI_LABELS[kpi],
                'Shapiro_W': float('nan'),
                'p':         float('nan'),
                'normal_05': 'N/A (constant sample)',
            })
            continue
        w, p = stats.shapiro(vals)
        rows.append({
            'KPI':        KPI_LABELS[kpi],
            'Shapiro_W':  float(w),
            'p':          float(p),
            'normal_05':  'YES' if p > 0.05 else 'NO',
        })
    return pd.DataFrame(rows)


def main() -> None:
    apply_style()
    print('§4 — Accuracy of the sample mean')

    runs = load_runs()
    base_b = runs[runs['is_baseline_B']].copy()
    assert len(base_b) == 30, f'Expected 30 baseline-B reps; got {len(base_b)}'

    write_table(accuracy_table(base_b), '04_accuracy.md', floatfmt='.4f')
    save_figure(running_mean_figure(base_b), '04_running_mean.png')
    write_table(normality_table(base_b), '04_normality.md', floatfmt='.4f')


if __name__ == '__main__':
    main()
