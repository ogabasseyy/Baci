const MAX_CATEGORY_CONTEXT = 5;
const MAX_OUTCOMES = 5;
const MAX_SAMPLES = 3;
const safeArray = (value) => (Array.isArray(value) ? value : []);
const safeString = (value) => (typeof value === 'string' ? value : '');

function publicCase(item) {
  return {
    caseId: safeString(item.key),
    category: safeString(item.category),
    draftPr: item.draftPr,
    fingerprint: safeString(item.fingerprint),
    firstSeen: safeString(item.firstSeen),
    lastSeen: safeString(item.lastSeen),
    outcomes: safeArray(item.outcomes).slice(-MAX_OUTCOMES),
    recurrenceCount: Number(item.recurrenceCount) || 0,
    samples: safeArray(item.samples).slice(-MAX_SAMPLES),
    source: safeString(item.source),
    status: safeString(item.status),
    totalObservations: Number(item.totalObservations) || 0,
  };
}

export function contextForCandidate(state, candidate) {
  return {
    cases: Object.values(state.cases)
      .filter(
        (item) =>
          item.category === candidate.category && item.key !== candidate.caseKey
      )
      .sort((left, right) =>
        safeString(right.lastSeen).localeCompare(safeString(left.lastSeen))
      )
      .slice(0, MAX_CATEGORY_CONTEXT)
      .map(publicCase),
    category: candidate.category,
  };
}

export function candidateWithLifecycle(state, candidate, options = {}) {
  const item = state.cases[candidate.caseKey];
  if (!item) {
    throw new Error(`Missing remediation lifecycle case: ${candidate.caseKey}`);
  }
  return {
    caseKey: candidate.caseKey,
    category: candidate.category,
    fingerprint: candidate.fingerprint,
    firstSeen: candidate.firstSeen,
    lastSeen: candidate.lastSeen,
    observationMarker: candidate.observationMarker,
    occurrences: candidate.occurrences,
    sample: candidate.sample,
    source: candidate.source,
    caseContext: contextForCandidate(state, candidate),
    caseId: safeString(item.key),
    draftPr: item.draftPr || null,
    history: safeArray(item.outcomes).slice(-MAX_OUTCOMES),
    lifecycleEvent: options.lifecycleEvent ?? candidate.lifecycleEvent,
    recurrenceCount: Number(item.recurrenceCount) || 0,
    status: safeString(item.status),
    autofixEligible: options.autofixEligible ?? candidate.autofixEligible,
  };
}
