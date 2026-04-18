"""§3 — Steady-state vs non-steady-state.

The ward is a terminating simulation: one 8-hour shift with defined start and
end. Method of independent replications is therefore appropriate (which
BatchRunner already implements); batch-means/deletion-of-initial-transient
would only apply to an infinite-horizon steady-state study.

Warm-up tick count (currently 50) is still worth validating empirically via
Welch's graphical method, since discarding fewer ticks than needed would bias
the aggregated KPIs.

Produces:
- 03_welch_graphical.png   — stacked cumulative-mean plots for three key KPIs
- 03_warmup.md             — transient-end tick per KPI + adequacy verdict
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from common import (
    apply_style, load_ticks, write_table, save_figure,
)


WINDOW = 25  # moving-window size for Welch smoothing (ticks)
CURRENT_WARMUP = 50


def welch_smooth(series: pd.Series, window: int = WINDOW) -> pd.Series:
    return series.rolling(window, min_periods=1, center=True).mean()


def cumulative_mean_across_reps(ticks: pd.DataFrame) -> pd.DataFrame:
    avg = ticks.groupby('tick').agg({
        'averagePatientHealth': 'mean',
        'activeNeedCount':      'mean',
        'nurseUtilisation':     'mean',
    }).reset_index()
    for col in ['averagePatientHealth', 'activeNeedCount', 'nurseUtilisation']:
        avg[f'{col}_smooth'] = welch_smooth(avg[col])
    return avg


def welch_figure(avg: pd.DataFrame) -> plt.Figure:
    fig, axes = plt.subplots(3, 1, figsize=(10, 8), constrained_layout=True, sharex=True)
    panels = [
        ('averagePatientHealth', 'Avg patient health'),
        ('activeNeedCount',      'Active needs'),
        ('nurseUtilisation',     'Nurse utilisation'),
    ]
    for ax, (col, label) in zip(axes, panels):
        ax.plot(avg['tick'], avg[col], alpha=0.25, color='#57534E', label='Raw mean')
        ax.plot(avg['tick'], avg[f'{col}_smooth'], lw=2, color='#0D9488',
                label=f'Welch-smoothed (window={WINDOW})')
        ax.axvline(CURRENT_WARMUP, color='#EF4444', lw=1.2, ls='--',
                   label=f'Current warm-up (tick {CURRENT_WARMUP})')
        ax.set_ylabel(label, fontsize=10)
        ax.legend(loc='best', fontsize=8)
    axes[-1].set_xlabel('Tick')
    fig.suptitle(
        "§3 — Welch's graphical method on baseline-B tick history\n(averaged across 30 replications)",
        fontsize=12,
    )
    return fig


def first_in_band(ticks_arr: np.ndarray, values: np.ndarray,
                  ref_start: int = 200, band: float = 0.05) -> float:
    """Return the first tick at which `values` enters a ±band envelope around its mean after `ref_start`."""
    ref = values[ticks_arr >= ref_start].mean()
    if not np.isfinite(ref) or ref == 0:
        return float('nan')
    lo, hi = ref * (1 - band), ref * (1 + band)
    within = (values >= lo) & (values <= hi)
    for t, ok in zip(ticks_arr, within):
        if ok:
            return float(t)
    return float('nan')


def warmup_table(avg: pd.DataFrame) -> tuple[pd.DataFrame, float]:
    rows = []
    for col, label in [
        ('averagePatientHealth', 'Avg patient health'),
        ('activeNeedCount',      'Active needs'),
        ('nurseUtilisation',     'Nurse utilisation'),
    ]:
        smoothed = avg[f'{col}_smooth'].values
        ticks_arr = avg['tick'].values
        entry = first_in_band(ticks_arr, smoothed)
        rows.append({'KPI': label, 'Transient ends at tick': entry})
    df = pd.DataFrame(rows)
    recommended = float(np.nanmax(df['Transient ends at tick'].values))
    return df, recommended


def main() -> None:
    apply_style()
    print('§3 — Steady-state vs non-steady-state')

    ticks = load_ticks()
    n_ticks_expected = 30 * 960
    if len(ticks) < n_ticks_expected:
        print(f'  note: tick_history.csv has {len(ticks)} rows (expected {n_ticks_expected}); continuing')

    avg = cumulative_mean_across_reps(ticks)
    save_figure(welch_figure(avg), '03_welch_graphical.png')

    warmup, recommended = warmup_table(avg)
    verdict = 'ADEQUATE' if recommended <= CURRENT_WARMUP else 'POSSIBLY TOO SHORT'
    verdict_row = pd.DataFrame([
        {'KPI': '— Recommended warm-up (max across KPIs) —',
         'Transient ends at tick': recommended},
        {'KPI': f'— Current setting: {CURRENT_WARMUP} ticks → {verdict} —',
         'Transient ends at tick': float('nan')},
    ])
    full = pd.concat([warmup, verdict_row], ignore_index=True)
    write_table(full, '03_warmup.md', floatfmt='.1f')
    print(f'  verdict: {verdict} (recommended {recommended:.1f} ticks, current {CURRENT_WARMUP})')


if __name__ == '__main__':
    main()
