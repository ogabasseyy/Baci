export function reconcileRemediationLifecycle({
  caseState,
  candidates,
  journal,
  state,
}) {
  const handledCandidates = state.handledCandidates(candidates);
  if (!handledCandidates) {
    throw new Error('remediation state is busy');
  }
  if (!caseState.migrateLegacyHandled(handledCandidates)) {
    throw new Error('remediation case state is busy');
  }
  const recovered = caseState.reconcile(candidates);
  let replayedJournal = false;
  const replayedRecurrences = [];
  for (const entry of journal.entries()) {
    const candidate =
      recovered.find((item) => item.caseKey === entry.caseKey) ||
      candidateFromLedger(caseState, entry);
    if (!candidate) continue;
    const recorded = caseState.recordOutcome(candidate, entry);
    if (!recorded) {
      throw new Error('remediation case state is busy');
    }
    const lifecycleCandidate = recorded === true ? candidate : recorded;
    if (!state.complete({ handledCandidates: [lifecycleCandidate] })) {
      throw new Error('remediation state is busy');
    }
    journal.clear(entry.caseKey);
    replayedJournal = true;
    replayedRecurrences.push({
      ...lifecycleCandidate,
      autofixEligible: false,
      lifecycleEvent:
        lifecycleCandidate.recurrenceCount > 0
          ? 'active_draft_recurrence'
          : 'pr_recovered',
    });
  }
  if (!replayedJournal) return recovered;
  return [
    ...new Map(
      [...caseState.reconcile(candidates), ...replayedRecurrences].map(
        (candidate) => [candidate.caseKey, candidate]
      )
    ).values(),
  ];
}

function candidateFromLedger(caseState, entry) {
  const item = caseState.snapshot().cases[entry.caseKey];
  if (!item || item.fingerprint !== entry.fingerprint) return null;
  return {
    caseKey: entry.caseKey,
    category: item.category,
    fingerprint: item.fingerprint,
    firstSeen: item.firstSeen || '',
    lastSeen: item.lastSeen || '',
    observationMarker: entry.observation,
    occurrences: Number(item.observedOccurrences || 0),
    sample: item.samples.at(-1) || {},
    source: item.source,
  };
}
