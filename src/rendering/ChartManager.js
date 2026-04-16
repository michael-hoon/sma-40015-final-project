/**
 * @fileoverview Chart.js dashboard — real-time patient health line chart
 * and active needs bar chart. Expects Chart to be available globally (CDN).
 */

const MAX_POINTS = 200; // rolling window

// Global Chart.js defaults — warm light clinical theme
Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
Chart.defaults.color = '#57534E';

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
            borderColor: '#0D9488',
            backgroundColor: 'rgba(13,148,136,0.08)',
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 2,
            fill: true,
          },
          {
            label: 'Lowest',
            data: [],
            borderColor: '#EF4444',
            backgroundColor: 'transparent',
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 1.5,
            borderDash: [4, 4],
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
            border: { display: false },
            ticks: { maxTicksLimit: 8, color: '#57534E', font: { size: 10 } },
            grid: { color: '#E7E5E4' },
          },
          y: {
            min: 0,
            max: 100,
            border: { display: false },
            ticks: { color: '#57534E', font: { size: 10 } },
            grid: { color: '#E7E5E4' },
          },
        },
        plugins: {
          legend: {
            labels: { color: '#1C1917', font: { size: 11 }, boxWidth: 12, usePointStyle: true },
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
            backgroundColor: ['#EF4444', '#0EA5E9', '#F59E0B', '#8B5CF6'],
            borderRadius: 6,
            borderSkipped: false,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            border: { display: false },
            ticks: { color: '#57534E', font: { size: 10 } },
            grid: { display: false },
          },
          y: {
            min: 0,
            border: { display: false },
            ticks: { color: '#57534E', font: { size: 10 }, stepSize: 1 },
            grid: { color: '#E7E5E4' },
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
