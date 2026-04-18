"""Run all four analysis scripts in order.

Exits non-zero on the first failure so a broken §2 doesn't silently skip §3.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SCRIPTS = [
    'analysis_01_types.py',
    'analysis_02_sensitivity.py',
    'analysis_03_steady_state.py',
    'analysis_04_accuracy.py',
]


def main() -> int:
    here = Path(__file__).resolve().parent
    for script in SCRIPTS:
        print(f'\n━━━ {script} ━━━')
        r = subprocess.run([sys.executable, str(here / script)], check=False)
        if r.returncode != 0:
            print(f'\n{script} exited with {r.returncode}; stopping.')
            return r.returncode
    print('\nAll four sections complete.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
