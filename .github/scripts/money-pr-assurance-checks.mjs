// Confirms the CI checks a money-path PR relies on (database replay, SQL
// suites with their catalog and grant assertions, and the aggregate quality
// gate) finished green on the head commit.
import { matchesAny } from './money-pr-assurance-config.mjs';

function newestRun(runs) {
  return [...runs].sort((left, right) => right.id - left.id)[0];
}

export function evaluateRequiredChecks({
  checkRuns,
  requiredChecks,
  changedPaths,
}) {
  const failures = [];
  const pending = [];
  for (const required of requiredChecks) {
    const run = newestRun(
      checkRuns.filter(({ name }) => name === required.name)
    );
    if (run?.status !== 'completed') {
      pending.push(`${required.name} has not finished on the head commit.`);
      continue;
    }
    if (run.conclusion === 'success') continue;
    if (run.conclusion === 'skipped' && required.skipAllowedUnlessChanged) {
      const touched = changedPaths.filter((path) =>
        matchesAny(path, required.skipAllowedUnlessChanged)
      );
      if (touched.length === 0) continue;
      failures.push(
        `${required.name} was skipped although database files changed (${touched[0]}).`
      );
      continue;
    }
    failures.push(
      `${required.name} finished as ${run.conclusion ?? 'unknown'}, not success.`
    );
  }
  return { failures, pending };
}
