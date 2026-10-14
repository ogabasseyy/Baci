// Comparator for within-category rotation of remediation candidates.
// Unseen cases sort first, then the case whose last recorded outcome is
// oldest. Outcomes are only appended after a selection, so the trailing
// timestamp doubles as selection history with no ledger schema change.
// Recency is used instead of the outcome count because the history is
// capped at MAX_OUTCOMES and saturated cases would tie forever. The sort
// is stable, so ties keep the loader (highest-volume-first) order.
export function compareRemediationCasesByOutcomeRecency(cases) {
  const lastOutcomeAt = (caseKey) => cases[caseKey]?.outcomes?.at(-1)?.at || '';
  return (left, right) => {
    const leftAt = lastOutcomeAt(left.caseKey);
    const rightAt = lastOutcomeAt(right.caseKey);
    return leftAt < rightAt ? -1 : leftAt > rightAt ? 1 : 0;
  };
}
