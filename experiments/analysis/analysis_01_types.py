"""§1 — Types of analysis.

Produces:
- 01_descriptive.md           — per-scenario summary stats for each primary KPI
- 01_paired_comparison.md     — paired t / bootstrap / Holm-adjusted p
- 01_critical_nonparametric.md (conditional) — Mann-Whitney U if critical incidents are zero-inflated
- 01_descriptive_boxplot_cdf.png — boxplot + CDF, one panel per KPI
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import scipy.stats as stats
import matplotlib.pyplot as plt
import seaborn as sns

from common import (
    apply_style, load_runs, PRIMARY_KPIS, KPI_LABELS,
    BASELINE_A_CELL, BASELINE_B_CELL,
    paired_analysis, holm_bonferroni,
    write_table, save_figure, TAB_DIR,
)


def descriptive_table(base_a: pd.DataFrame, base_b: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for kpi in PRIMARY_KPIS:
        for label, df in [('A (nurses only)', base_a), ('B (nurses + robots)', base_b)]:
            s = df[kpi]
            rows.append({
                'KPI':      KPI_LABELS[kpi],
                'Scenario': label,
                'n':        len(s),
                'mean':     s.mean(),
                'std':      s.std(ddof=1),
                'min':      s.min(),
                'max':      s.max(),
                'median':   s.median(),
            })
    return pd.DataFrame(rows)


def descriptive_figure(base_a: pd.DataFrame, base_b: pd.DataFrame) -> plt.Figure:
    fig, axes = plt.subplots(
        2, len(PRIMARY_KPIS),
        figsize=(4 * len(PRIMARY_KPIS), 6),
        constrained_layout=True,
    )
    for i, kpi in enumerate(PRIMARY_KPIS):
        ax_box = axes[0, i]
        ax_cdf = axes[1, i]

        combined = pd.concat([
            base_a.assign(scenario='A'),
            base_b.assign(scenario='B'),
        ])
        sns.boxplot(
            data=combined, x='scenario', y=kpi, ax=ax_box,
            palette=['#3F7E5A', '#0D9488'],
        )
        ax_box.set_title(KPI_LABELS[kpi], fontsize=10)
        ax_box.set_xlabel('')
        ax_box.set_ylabel('')

        for label, df, colour in [('A', base_a, '#3F7E5A'), ('B', base_b, '#0D9488')]:
            vals = np.sort(df[kpi].values)
            cdf  = np.arange(1, len(vals) + 1) / len(vals)
            ax_cdf.plot(vals, cdf, label=label, color=colour, lw=2)
        ax_cdf.set_xlabel(KPI_LABELS[kpi], fontsize=9)
        ax_cdf.set_ylabel('CDF')
        ax_cdf.legend(loc='lower right', fontsize=8)

    fig.suptitle('§1 — Per-scenario KPI distributions (baseline staffing)', fontsize=12)
    return fig


def paired_table(base_a: pd.DataFrame, base_b: pd.DataFrame) -> pd.DataFrame:
    a = base_a.sort_values('seed').reset_index(drop=True)
    b = base_b.sort_values('seed').reset_index(drop=True)
    assert (a['seed'].values == b['seed'].values).all(), \
        'Baseline A and B seeds must align for paired analysis'

    rows = []
    for kpi in PRIMARY_KPIS:
        r = paired_analysis(a[kpi], b[kpi])
        rows.append({
            'KPI':         KPI_LABELS[kpi],
            'mean_A':      r['mean_a'],
            'mean_B':      r['mean_b'],
            'mean_diff':   r['mean_diff'],
            'paired_t':    r['t'],
            'p_raw':       r['p'],
            'cohen_dz':    r['cohen_dz'],
            'boot95_low':  r['boot_ci_low'],
            'boot95_high': r['boot_ci_high'],
        })
    df = pd.DataFrame(rows)
    df['p_holm']   = holm_bonferroni(df['p_raw'].values)
    df['sig_holm'] = np.where(df['p_holm'] < 0.05, '✓', '')
    return df


def critical_nonparametric(base_a: pd.DataFrame, base_b: pd.DataFrame) -> str | None:
    zero_a = (base_a['criticalIncidentCount'] == 0).mean()
    zero_b = (base_b['criticalIncidentCount'] == 0).mean()
    msg = (
        f'Zero-inflation: A = {zero_a:.0%}, B = {zero_b:.0%}\n'
    )
    if max(zero_a, zero_b) <= 0.5:
        return msg + '\n(Neither scenario is heavily zero-inflated — paired t is adequate.)'

    u_stat, p_u = stats.mannwhitneyu(
        base_a['criticalIncidentCount'],
        base_b['criticalIncidentCount'],
        alternative='two-sided',
    )
    return (
        msg
        + '\nBecause zero-inflation exceeds 50%, we also report Mann-Whitney U:\n\n'
        + f'- U = {u_stat:.1f}\n'
        + f'- p = {p_u:.4f}\n'
    )


def main() -> None:
    apply_style()
    print('§1 — Types of analysis')

    runs = load_runs()
    base_a = runs[runs['is_baseline_A']].copy()
    base_b = runs[runs['is_baseline_B']].copy()
    assert len(base_a) == 30 and len(base_b) == 30, \
        f'Expected 30 reps each; got A={len(base_a)}, B={len(base_b)}'

    desc = descriptive_table(base_a, base_b)
    write_table(desc, '01_descriptive.md', floatfmt='.3f')

    fig = descriptive_figure(base_a, base_b)
    save_figure(fig, '01_descriptive_boxplot_cdf.png')

    paired = paired_table(base_a, base_b)
    write_table(paired, '01_paired_comparison.md', floatfmt='.4f')

    note = critical_nonparametric(base_a, base_b)
    if note:
        (TAB_DIR / '01_critical_nonparametric.md').write_text(note)
        print(f'  wrote {TAB_DIR / "01_critical_nonparametric.md"}')


if __name__ == '__main__':
    main()
