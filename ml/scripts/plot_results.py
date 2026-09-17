"""Render standalone scientific comparison figures from frozen test results."""
import json
import os
import tempfile
from pathlib import Path

os.environ.setdefault('MPLCONFIGDIR', str(Path(tempfile.gettempdir()) / 'pump-hawk-matplotlib'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ML = Path(__file__).resolve().parents[1]
OUT = ML / 'reports'
OUT.mkdir(exist_ok=True)
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11, 'axes.spines.top': False,
                     'axes.spines.right': False, 'figure.facecolor': '#fafaf7', 'axes.facecolor': '#fafaf7'})
fig, axes = plt.subplots(2, 2, figsize=(14, 9), constrained_layout=True)
for row, mode in enumerate(['weekly', 'daily']):
    directory = ML / 'experiments' / mode
    report = json.loads((directory / 'test-report.json').read_text())
    keys = ['7', '14'] if mode == 'weekly' else ['1', '3', '7', '14']
    labels = ['Next weekly\nobservation', 'Second weekly\nobservation'] if mode == 'weekly' else ['1 day', '3 days', '7 days', '14 days']
    x = np.arange(len(keys))
    model = [report['horizons'][h]['model']['mae'] for h in keys]
    base = [report['horizons'][h]['baseline']['mae'] for h in keys]
    ax = axes[row, 0]
    for bars in [ax.bar(x-.18, base, .36, color='#c6c9c7', label='Validation-selected baseline'),
                 ax.bar(x+.18, model, .36, color='#16826c', label='Frozen model')]:
        ax.bar_label(bars, fmt='%.2f', padding=3, fontsize=10)
    ax.set_xticks(x, labels)
    ax.set_ylabel('Mean absolute error (pence/litre)')
    ax.set_ylim(0, max(model + base) * 1.3)
    ax.set_title(f'{mode.title()} model — sealed test error', loc='left', weight='bold')
    ax.legend(frameon=False, fontsize=9)
    predictions = pd.read_csv(directory / 'test-predictions.csv', parse_dates=['target_date'])
    curve = predictions[predictions.horizon == 7].sort_values('target_date')
    ax = axes[row, 1]
    if mode == 'weekly':
        ax.scatter(curve.target_date, curve.actual_price, color='#202825', s=26, label='Observed weekly price')
        ax.scatter(curve.target_date, curve.predicted_price, color='#16826c', s=26, marker='x', label='Predicted weekly price')
        ax.vlines(curve.target_date, curve.interval_lower, curve.interval_upper, color='#16826c', alpha=.25)
        ax.set_title('Next official weekly observation', loc='left', weight='bold')
    else:
        ax.plot(curve.target_date, curve.actual_price, color='#202825', label='Observed daily price')
        ax.plot(curve.target_date, curve.predicted_price, color='#16826c', linestyle='--', label='7-day prediction')
        ax.fill_between(curve.target_date, curve.interval_lower, curve.interval_upper, color='#16826c', alpha=.15, label='Empirical 90% band')
        ax.set_title('Daily observations and 7-day predictions', loc='left', weight='bold')
    ax.set_ylabel('Petrol price (pence/litre)')
    ax.tick_params(axis='x', rotation=25)
    ax.legend(frameon=False, fontsize=9)
fig.suptitle('Pump Hawk: independent weekly and daily models\nFinal test periods were excluded from model selection', fontsize=17, weight='bold')
fig.savefig(OUT / 'sealed-test-results.png', dpi=180)
plt.close(fig)
print(OUT / 'sealed-test-results.png')
