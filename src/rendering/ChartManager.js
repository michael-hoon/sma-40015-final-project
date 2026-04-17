/**
 * @fileoverview Chart.js dashboard — real-time patient health line chart,
 * active needs bar chart, and sparkline factory for KPI watermarks.
 * Expects Chart to be available globally (CDN).
 *
 * Palette: sage green primary (#5F9B7C), muted need colours, warm chart grids.
 */

const MAX_POINTS = 200; // rolling window for main charts
const SPARK_MAX  = 80;  // rolling window for sparklines

// ── Global Chart.js defaults — warm light clinical theme ──────────────────────
Chart.defaults.font.family    = "'IBM Plex Sans', system-ui, sans-serif";
Chart.defaults.color          = '#57534E';
Chart.defaults.borderColor    = '#E7E5E4';

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

  // ── Main chart constructors ─────────────────────────────────────────────────

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
            borderColor: '#5F9B7C',
            backgroundColor: 'rgba(95,155,124,0.10)',
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4,
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
            ticks: { maxTicksLimit: 8, color: '#A8A29E', font: { size: 10 } },
            grid: { display: false },
          },
          y: {
            min: 0,
            max: 100,
            border: { display: false },
            ticks: { color: '#A8A29E', font: { size: 10 } },
            grid: { color: '#E7E5E4', drawBorder: false },
          },
        },
        plugins: {
          legend: {
            labels: {
              color: '#57534E',
              font: { size: 11, family: "'IBM Plex Sans', system-ui, sans-serif" },
              boxWidth: 12,
              usePointStyle: true,
            },
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
            backgroundColor: ['#EF4444', '#4F92B5', '#E3AA55', '#9B7FB8'],
            borderRadius: 8,
            borderSkipped: false,
            maxBarThickness: 42,
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
            ticks: { color: '#A8A29E', font: { size: 10 } },
            grid: { display: false },
          },
          y: {
            min: 0,
            border: { display: false },
            ticks: { color: '#A8A29E', font: { size: 10 }, stepSize: 1 },
            grid: { color: '#E7E5E4', drawBorder: false },
          },
        },
        plugins: {
          legend: { display: false },
        },
      },
    });
  }

  // ── Static sparkline factory ────────────────────────────────────────────────

  /**
   * Build a lightweight sparkline chart for KPI card watermarks.
   * No axes, no grid, no legend — thin filled-area line.
   * Caller is responsible for pushing data and calling update().
   *
   * @param {HTMLCanvasElement} canvas
   * @param {string} colour - CSS hex colour for the line (#RRGGBB)
   * @returns {Chart}
   */
  static buildSparkline(canvas, colour) {
    // Derive a low-opacity fill from the hex colour
    const r = parseInt(colour.slice(1, 3), 16);
    const g = parseInt(colour.slice(3, 5), 16);
    const b = parseInt(colour.slice(5, 7), 16);
    const fill = `rgba(${r},${g},${b},0.18)`;

    return new Chart(canvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          data: [],
          borderColor: colour,
          backgroundColor: fill,
          borderWidth: 1.5,
          tension: 0.4,
          pointRadius: 0,
          fill: true,
        }],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend:  { display: false },
          tooltip: { enabled: false },
        },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    });
  }

  // ── Data push ───────────────────────────────────────────────────────────────

  /**
   * Push one tick snapshot to the main charts. Called once per simulated tick.
   * @param {object} snapshot - tickHistory entry
   * @param {object[]} allNeeds - NeedQueue.getAll()
   */
  pushTick(snapshot, allNeeds) {
    const { tick, averagePatientHealth, lowestPatientHealth } = snapshot;

    // Health line chart (rolling window)
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

    // Needs bar chart
    const active = allNeeds.filter(n => n.status !== 'fulfilled');
    this._needsChart.data.datasets[0].data = [
      active.filter(n => n.type === 'emergency').length,
      active.filter(n => n.type === 'medication').length,
      active.filter(n => n.type === 'comfort').length,
      active.filter(n => n.type === 'visitor_escort').length,
    ];
    this._needsChart.update('none');
  }

  /** Reset both main charts to empty (called on simulation reset). */
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
