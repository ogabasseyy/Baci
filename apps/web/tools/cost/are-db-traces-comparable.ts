import type { CostWindowMeasurement } from './measure-vercel-storefront-cost-types';

/** True when before/after DB traces share cohorts and per-cohort sample sizes. */
export function areDbTracesComparable(
  before: CostWindowMeasurement,
  after: CostWindowMeasurement
): boolean {
  if (!before.dbTrace || !after.dbTrace) return false;
  if (before.dbTrace.rows !== after.dbTrace.rows) return false;
  const beforeTrace = before.dbTrace;
  const afterTrace = after.dbTrace;
  const beforeCohorts = Object.keys(beforeTrace.byCohort).sort();
  const afterCohorts = Object.keys(afterTrace.byCohort).sort();
  if (
    beforeCohorts.length === 0 ||
    beforeCohorts.includes('unknown') ||
    afterCohorts.includes('unknown')
  )
    return false;
  if (beforeCohorts.length !== afterCohorts.length) return false;
  return beforeCohorts.every((cohort, index) => {
    if (cohort !== afterCohorts[index]) return false;
    return (
      beforeTrace.byCohort[cohort].rows === afterTrace.byCohort[cohort].rows
    );
  });
}
