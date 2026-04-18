"""§2 — Sensitivity analysis.

Produces:
- 02_main_effects.md              — standardised main-effects table from factorial OLS
- 02_tornado_main_effects.png     — tornado of standardised coefs per KPI
- 02_interaction_heatmap.png      — nurse × MEDi grid coloured by response time + incidents
- 02_waittime_vs_fleet.png        — wait time vs total robot fleet, faceted by nurse count
- 02_oat_curves.png               — OAT sensitivity curves for load parameters
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
import matplotlib.pyplot as plt
import seaborn as sns

from common import (
    apply_style, load_runs, PRIMARY_KPIS, KPI_LABELS,
    write_table, save_figure,
)


FACTORS = ['NURSE_COUNT', 'MEDI_COUNT', 'BLANKI_COUNT', 'EDI_COUNT']


def standardised_main_effects(factorial: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for kpi in PRIMARY_KPIS:
        X = factorial[FACTORS].copy()
        X = (X - X.mean()) / X.std(ddof=0)
        y = factorial[kpi]
        df_fit = X.assign(y=y.values)
        model = smf.ols('y ~ NURSE_COUNT + MEDI_COUNT + BLANKI_COUNT + EDI_COUNT', data=df_fit).fit()
        ci = model.conf_int()
        for factor in FACTORS:
            rows.append({
                'KPI':      KPI_LABELS[kpi],
                'Factor':   factor,
                'Std_Coef': model.params[factor],
                'p':        model.pvalues[factor],
                'CI_low':   ci.loc[factor, 0],
                'CI_high':  ci.loc[factor, 1],
            })
    return pd.DataFrame(rows)


def tornado_figure(effects: pd.DataFrame) -> plt.Figure:
    n = len(PRIMARY_KPIS)
    fig, axes = plt.subplots(1, n, figsize=(4 * n, 3.5), constrained_layout=True, sharey=True)
    for ax, kpi in zip(axes, PRIMARY_KPIS):
        sub = effects[effects['KPI'] == KPI_LABELS[kpi]].copy()
        sub = sub.reindex(sub['Std_Coef'].abs().sort_values(ascending=True).index)
        colours = np.where(sub['Std_Coef'] < 0, '#0D9488', '#D97706')
        xerr = np.vstack([
            (sub['Std_Coef'] - sub['CI_low']).values,
            (sub['CI_high'] - sub['Std_Coef']).values,
        ])
        ax.barh(sub['Factor'], sub['Std_Coef'], color=colours, xerr=xerr, capsize=3)
        ax.axvline(0, color='k', lw=0.8)
        ax.set_title(KPI_LABELS[kpi], fontsize=10)
        ax.set_xlabel('Standardised coef.', fontsize=9)
    fig.suptitle('§2 — Standardised main-effects tornado (factorial data)', fontsize=12)
    return fig


def interaction_heatmap(factorial: pd.DataFrame) -> plt.Figure:
    slice_df = factorial[(factorial['BLANKI_COUNT'] == 1) & (factorial['EDI_COUNT'] == 1)]
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5), constrained_layout=True)
    for ax, kpi, cmap in [
        (axes[0], 'meanEmergencyResponseTime', 'mako_r'),
        (axes[1], 'criticalIncidentCount',     'rocket_r'),
    ]:
        pivot = slice_df.groupby(['NURSE_COUNT', 'MEDI_COUNT'])[kpi].mean().unstack('MEDI_COUNT')
        sns.heatmap(pivot, annot=True, fmt='.2f', cmap=cmap, ax=ax,
                    cbar_kws={'label': KPI_LABELS[kpi]})
        ax.set_title(f'{KPI_LABELS[kpi]}\n(BLANKi=1, EDi=1)', fontsize=10)
        ax.set_xlabel('MEDi count')
        ax.set_ylabel('Nurse count')
    fig.suptitle('§2 — Nurse × MEDi interaction', fontsize=12)
    return fig


def waittime_facet(factorial: pd.DataFrame) -> sns.axisgrid.FacetGrid:
    melted = factorial.melt(
        id_vars=FACTORS,
        value_vars=['meanWaitTime_emergency', 'meanWaitTime_medication'],
        var_name='KPI', value_name='value',
    )
    melted['KPI'] = melted['KPI'].map(KPI_LABELS)
    melted['fleet_total'] = melted['MEDI_COUNT'] + melted['BLANKI_COUNT'] + melted['EDI_COUNT']
    g = sns.catplot(
        data=melted, kind='box',
        x='fleet_total', y='value', col='NURSE_COUNT', row='KPI',
        sharey=False, height=3, aspect=1.3, palette='mako_r',
    )
    g.set_titles('Nurses={col_name} · {row_name}')
    g.set_axis_labels('Total robot fleet size', 'Wait time (ticks)')
    return g


def oat_figure(oat: pd.DataFrame) -> plt.Figure:
    n = len(PRIMARY_KPIS)
    fig, axes = plt.subplots(2, n, figsize=(4 * n, 6), constrained_layout=True)
    for r, block in enumerate(['oat_medication', 'oat_emergency']):
        sub = oat[oat['block'] == block]
        rate_col = 'needSpawn_medication' if block == 'oat_medication' else 'needSpawn_emergency'
        for c, kpi in enumerate(PRIMARY_KPIS):
            ax = axes[r, c]
            agg = sub.groupby(rate_col)[kpi].agg(['mean', 'std', 'count']).reset_index()
            agg['sem'] = agg['std'] / np.sqrt(agg['count'])
            ax.errorbar(agg[rate_col], agg['mean'], yerr=1.96 * agg['sem'],
                        fmt='-o', color='#0D9488', capsize=3)
            ax.set_title(KPI_LABELS[kpi], fontsize=9)
            ax.set_xlabel(rate_col, fontsize=8)
            if c == 0:
                ax.set_ylabel('Medication sweep' if block == 'oat_medication' else 'Emergency sweep')
    fig.suptitle('§2 — OAT sensitivity curves (95% CI)', fontsize=12)
    return fig


def main() -> None:
    apply_style()
    print('§2 — Sensitivity analysis')

    runs = load_runs()
    fact = runs[runs['block'] == 'factorial'].copy()
    oat  = runs[runs['block'].isin(['oat_medication', 'oat_emergency'])].copy()
    assert fact['cellId'].nunique() == 108, f'Expected 108 factorial cells; got {fact["cellId"].nunique()}'

    effects = standardised_main_effects(fact)
    write_table(effects, '02_main_effects.md', floatfmt='.4f')

    save_figure(tornado_figure(effects), '02_tornado_main_effects.png')
    save_figure(interaction_heatmap(fact), '02_interaction_heatmap.png')

    # FacetGrid — save via its own .fig attribute
    g = waittime_facet(fact)
    save_figure(g.fig, '02_waittime_vs_fleet.png')

    save_figure(oat_figure(oat), '02_oat_curves.png')


if __name__ == '__main__':
    main()
