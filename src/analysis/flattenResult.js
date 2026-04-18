/**
 * @fileoverview Convert a Scheduler.getStats() result + factor values
 * into a flat object suitable for a single CSV row.
 *
 * Nested fields like meanWaitTime.emergency become `meanWaitTime_emergency`.
 * Count dicts like totalNeedsGenerated become `needsGenerated_emergency`, etc.
 *
 * The resulting row also carries all factor values + seed + cell tag for
 * downstream grouping/analysis.
 */

/**
 * @param {object} params
 * @param {object} params.stats        - Output of Scheduler.getStats()
 * @param {object} params.factors      - { NURSE_COUNT, MEDI_COUNT, BLANKI_COUNT, EDI_COUNT, ... }
 * @param {number} params.seed
 * @param {string} params.cellId       - Stable identifier for this design cell (e.g. "N5_M1_B1_E1")
 * @param {string} params.sweepId      - Identifier for the full sweep run
 * @returns {object} Flat key→number row
 */
export function flattenResult({ stats, factors, seed, cellId, sweepId }) {
  const row = {
    sweepId,
    cellId,
    seed,
    // Primary factors — always present
    NURSE_COUNT:   factors.NURSE_COUNT   ?? 0,
    MEDI_COUNT:    factors.MEDI_COUNT    ?? 0,
    BLANKI_COUNT:  factors.BLANKI_COUNT  ?? 0,
    EDI_COUNT:     factors.EDI_COUNT     ?? 0,
    // Load factors (OAT); present with baseline values if not swept
    needSpawn_emergency:      factors.needSpawn_emergency      ?? null,
    needSpawn_medication:     factors.needSpawn_medication     ?? null,
    needSpawn_comfort:        factors.needSpawn_comfort        ?? null,
    needSpawn_visitor_escort: factors.needSpawn_visitor_escort ?? null,
    // KPIs — flat scalars
    criticalIncidentCount:        stats.criticalIncidentCount,
    meanEmergencyResponseTime:    stats.meanEmergencyResponseTime,
    needsUnfulfilledAtEnd:        stats.needsUnfulfilledAtEnd,
    meanNurseUtilisation:         stats.meanNurseUtilisation,
    meanRobotUtilisation:         stats.meanRobotUtilisation,
    // KPIs — nested, flattened
    meanWaitTime_emergency:       stats.meanWaitTime.emergency,
    meanWaitTime_medication:      stats.meanWaitTime.medication,
    meanWaitTime_comfort:         stats.meanWaitTime.comfort,
    meanWaitTime_visitor_escort:  stats.meanWaitTime.visitor_escort,
    needsGenerated_emergency:       stats.totalNeedsGenerated.emergency,
    needsGenerated_medication:      stats.totalNeedsGenerated.medication,
    needsGenerated_comfort:         stats.totalNeedsGenerated.comfort,
    needsGenerated_visitor_escort:  stats.totalNeedsGenerated.visitor_escort,
    needsFulfilled_emergency:       stats.totalNeedsFulfilled.emergency,
    needsFulfilled_medication:      stats.totalNeedsFulfilled.medication,
    needsFulfilled_comfort:         stats.totalNeedsFulfilled.comfort,
    needsFulfilled_visitor_escort:  stats.totalNeedsFulfilled.visitor_escort,
  };
  return row;
}

/**
 * Build a CSV string from an array of flat rows. Column order is taken
 * from the keys of the first row. Missing values render as empty string.
 * @param {object[]} rows
 * @returns {string}
 */
export function rowsToCsv(rows) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const body = rows.map(r =>
    headers.map(h => {
      const v = r[h];
      if (v === null || v === undefined) return '';
      if (typeof v === 'string') return `"${v.replace(/"/g, '""')}"`;
      return Number.isFinite(v) ? v : '';
    }).join(',')
  );
  return [headers.join(','), ...body].join('\n');
}
