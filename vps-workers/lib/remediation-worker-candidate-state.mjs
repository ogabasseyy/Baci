export function recordRemediationOutcome({
  candidate,
  candidates,
  caseState,
  outcome,
  pendingCandidate,
}) {
  const recorded = caseState.recordOutcome(candidate, outcome);
  if (!recorded) throw new Error('remediation case state is busy');
  const lifecycleCandidate = recorded === true ? candidate : recorded;
  return candidates.map((selected) =>
    selected === pendingCandidate ? lifecycleCandidate : selected
  );
}
