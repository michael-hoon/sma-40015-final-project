"""Shared constants, paths, and helpers for the output-analysis scripts.

All four analysis_0X_*.py scripts import from this module. Keep it small —
only things referenced by two or more scripts belong here.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import scipy.stats as stats
import matplotlib.pyplot as plt
import seaborn as sns

# ── Paths ────────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR     = PROJECT_ROOT / 'data'
FIG_DIR      = PROJECT_ROOT / 'experiments' / 'report' / 'figures'
TAB_DIR      = PROJECT_ROOT / 'experiments' / 'report' / 'tables'

FIG_DIR.mkdir(parents=True, exist_ok=True)
TAB_DIR.mkdir(parents=True, exist_ok=True)

# ── KPI catalogue ────────────────────────────────────────────────────────────

PRIMARY_KPIS = [
    'criticalIncidentCount',
    'meanEmergencyResponseTime',
    'meanWaitTime_emergency',
    'meanWaitTime_medication',
    'meanNurseUtilisation',
]

KPI_LABELS = {
    'criticalIncidentCount':     'Critical Incidents (count)',
    'meanEmergencyResponseTime': 'Emergency Response Time (ticks)',
    'meanWaitTime_emergency':    'Emergency Wait Time (ticks)',
    'meanWaitTime_medication':   'Medication Wait Time (ticks)',
    'meanNurseUtilisation':      'Nurse Utilisation (fraction)',
}

BASELINE_A_CELL = 'F_N5_M0_B0_E0'
BASELINE_B_CELL = 'F_N5_M1_B1_E1'

# ── Plot styling ─────────────────────────────────────────────────────────────

def apply_style() -> None:
    sns.set_theme(style='whitegrid', context='paper', palette='muted')
    plt.rcParams['figure.dpi']   = 110
    plt.rcParams['savefig.dpi']  = 300
    plt.rcParams['savefig.bbox'] = 'tight'


# ── Loaders ──────────────────────────────────────────────────────────────────

def load_runs() -> pd.DataFrame:
    """Load data/runs.csv and derive the `block` column from cellId prefix."""
    df = pd.read_csv(DATA_DIR / 'runs.csv')
    df['block'] = df['cellId'].str.split('_').str[0].map({
        'F':      'factorial',
        'OATmed': 'oat_medication',
        'OATemg': 'oat_emergency',
    })
    df['is_baseline_A'] = df['cellId'] == BASELINE_A_CELL
    df['is_baseline_B'] = df['cellId'] == BASELINE_B_CELL
    return df


def load_manifest() -> dict:
    return json.loads((DATA_DIR / 'manifest.json').read_text())


def load_ticks() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / 'tick_history.csv')


# ── Statistical helpers ──────────────────────────────────────────────────────

def ci_t(sample: np.ndarray | pd.Series, alpha: float = 0.05) -> dict:
    """Student-t CI for the mean of a sample. Returns mean, std, half-width, bounds, t_crit."""
    arr = np.asarray(sample, dtype=float)
    n   = len(arr)
    m   = arr.mean()
    s   = arr.std(ddof=1) if n > 1 else 0.0
    se  = s / np.sqrt(n) if n > 0 else 0.0
    t_crit = stats.t.ppf(1 - alpha / 2, n - 1) if n > 1 else float('nan')
    h   = t_crit * se if n > 1 else float('nan')
    return {
        'n':          n,
        'mean':       m,
        'std':        s,
        'half_width': h,
        'ci_low':     m - h if n > 1 else m,
        'ci_high':    m + h if n > 1 else m,
        't_crit':     t_crit,
    }


def paired_analysis(a_vals: pd.Series, b_vals: pd.Series,
                    n_boot: int = 10_000, rng_seed: int = 2026) -> dict:
    """Paired t-test + Cohen's d_z + bootstrap 95% CI on the mean difference.

    Assumes a_vals and b_vals are aligned (same seed in each position).
    """
    a = np.asarray(a_vals, dtype=float)
    b = np.asarray(b_vals, dtype=float)
    d = a - b
    t_stat, p_val = stats.ttest_rel(a, b)
    sd = d.std(ddof=1)
    dz = (d.mean() / sd) if sd > 0 else 0.0

    rng = np.random.default_rng(rng_seed)
    idx = rng.integers(0, len(d), size=(n_boot, len(d)))
    boot_means = d[idx].mean(axis=1)
    ci_low, ci_high = np.quantile(boot_means, [0.025, 0.975])

    return {
        'mean_a':       a.mean(),
        'mean_b':       b.mean(),
        'mean_diff':    d.mean(),
        't':            float(t_stat),
        'p':            float(p_val),
        'cohen_dz':     float(dz),
        'boot_ci_low':  float(ci_low),
        'boot_ci_high': float(ci_high),
    }


def holm_bonferroni(p_values: np.ndarray) -> np.ndarray:
    """Step-down Holm-Bonferroni adjustment."""
    ps = np.asarray(p_values, dtype=float)
    order = np.argsort(ps)
    m = len(ps)
    adj = np.zeros_like(ps)
    prev = 0.0
    for rank, i in enumerate(order):
        adj[i] = max(prev, min(1.0, (m - rank) * ps[i]))
        prev = adj[i]
    return adj


# ── Table writer ─────────────────────────────────────────────────────────────

def write_table(df: pd.DataFrame, filename: str, floatfmt: str = '.4f') -> None:
    """Write df as GitHub-flavour markdown to TAB_DIR/filename."""
    from tabulate import tabulate
    content = tabulate(df, headers='keys', tablefmt='github', floatfmt=floatfmt, showindex=False)
    (TAB_DIR / filename).write_text(content + '\n')
    print(f'  wrote {TAB_DIR / filename}')


def save_figure(fig, filename: str) -> None:
    path = FIG_DIR / filename
    fig.savefig(path)
    plt.close(fig)
    print(f'  wrote {path}')
