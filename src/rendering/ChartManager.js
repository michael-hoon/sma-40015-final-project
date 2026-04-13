/**
 * @fileoverview Chart.js dashboard — real-time patient health line chart
 * and active needs bar chart. Expects Chart to be available globally (CDN).
 */

const MAX_POINTS = 200; // rolling window

export default class ChartManager {
  /**
   * @param {object} params
   * @param {HTMLCanvasElement} params.healthCanvas
   * @param {HTMLCanvasElement} params.needsCanvas
   */
  constructor({ healthCanvas, needsCanvas }) {
    this._healthChart = this._buildHealthChart(healthCanvas);
    this._needsChart  = this._buildNeedsChart(needsCanvas);
  }

  /** @private */
  _buildHealthChart(canvas) {
    return new Chart(canvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Avg Health',
            data: [],
            borderColor: '#4caf50',
            backgroundColor: 'rgba(76,175,80,0.08)',
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
            fill: true,
          },
          {
            label: 'Lowest',
            data: [],
            borderColor: '#f44336',
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 1.5,
            borderDash: [5, 3],
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            ticks: { maxTicksLimit: 8, color: '#9ca3af', font: { size: 10 } },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            min: 0,
            max: 100,
            ticks: { color: '#9ca3af', font: { size: 10 } },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
        },
        plugins: {
          legend: {
            labels: { color: '#d1d5db', font: { size: 11 }, boxWidth: 14 },
          },
        },
      },
    });
  }

  /** @private */
  _buildNeedsChart(canvas) {
    return new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['Emergency', 'Medication', 'Comfort', 'Visitor'],
        datasets: [
          {
            label: 'Active needs',
            data: [0, 0, 0, 0],
            backgroundColor: [
              'rgba(244,67,54,0.75)',
              'rgba(33,150,243,0.75)',
              'rgba(255,152,0,0.75)',
              'rgba(156,39,176,0.75)',
            ],
            borderColor: ['#f44336', '#2196f3', '#ff9800', '#9c27b0'],
            borderWidth: 1,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: '#9ca3af', font: { size: 10 } },
            grid: { display: false },
          },
          y: {
            min: 0,
            ticks: { color: '#9ca3af', font: { size: 10 }, stepSize: 1 },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
        },
        plugins: {
          legend: { display: false },
        },
      },
    });
  }

  /**
   * Push one tick snapshot to the charts. Called once per simulated tick.
   * @param {object} snapshot - tickHistory entry
   * @param {object[]} allNeeds - NeedQueue.getAll()
   */
  pushTick(snapshot, allNeeds) {
    const { tick, averagePatientHealth, lowestPatientHealth } = snapshot;

    // ── Health line chart (rolling window) ──────────────────────────────────
    const hc = this._healthChart;
    hc.data.labels.push(tick);
    hc.data.datasets[0].data.push(averagePatientHealth);
    hc.data.datasets[1].data.push(lowestPatientHealth);
    if (hc.data.labels.length > MAX_POINTS) {
      hc.data.labels.shift();
      hc.data.datasets[0].data.shift();
      hc.data.datasets[1].data.shift();
    }
    hc.update('none');

    // ── Needs bar chart ──────────────────────────────────────────────────────
    const active = allNeeds.filter(n => n.status !== 'fulfilled');
    this._needsChart.data.datasets[0].data = [
      active.filter(n => n.type === 'emergency').length,
      active.filter(n => n.type === 'medication').length,
      active.filter(n => n.type === 'comfort').length,
      active.filter(n => n.type === 'visitor_escort').length,
    ];
    this._needsChart.update('none');
  }

  /** Reset both charts to empty (called on simulation reset). */
  clear() {
    const hc = this._healthChart;
    hc.data.labels = [];
    hc.data.datasets[0].data = [];
    hc.data.datasets[1].data = [];
    hc.update('none');

    this._needsChart.data.datasets[0].data = [0, 0, 0, 0];
    this._needsChart.update('none');
  }

  /** Destroy Chart.js instances (e.g. before re-mounting). */
  destroy() {
    this._healthChart.destroy();
    this._needsChart.destroy();
  }
}
