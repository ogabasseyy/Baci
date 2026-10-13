const isIsoDate = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

const isNonnegativeInteger = (value) =>
  Number.isSafeInteger(value) && value >= 0;

const isPlainObject = (value) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const hasOnlyKeys = (value, keys) =>
  Object.keys(value).every((key) => keys.has(key));

const isBoundedString = (value, limit) =>
  typeof value === 'string' && value.length <= limit;

export function createRemediationCaseStateValidator({
  caseStatuses,
  maxCases,
  maxOutcomes,
  maxSamples,
  version,
}) {
  const sampleFields = new Set([
    'appState',
    'deploymentId',
    'device',
    'deviceClass',
    'eventSource',
    'errorClass',
    'issueId',
    'mechanism',
    'message',
    'organization',
    'os',
    'platform',
    'project',
    'release',
    'requestId',
    'route',
    'source',
    'stackSummary',
    'statusCode',
  ]);
  const caseFields = new Set([
    'category',
    'draftPr',
    'firstSeen',
    'fingerprint',
    'key',
    'lastSeen',
    'observationMarker',
    'observedOccurrences',
    'outcomes',
    'recurrenceCount',
    'samples',
    'source',
    'status',
    'totalObservations',
  ]);
  const outcomeFields = new Set(['at', 'detail', 'prUrl', 'type']);
  const draftPrFields = new Set(['branch', 'openedAt', 'url']);
  const stateFields = new Set(['cases', 'fairness', 'version']);
  const fairnessFields = new Set(['draftPrCursor', 'lastCategory']);

  function validSample(sample) {
    if (!isPlainObject(sample) || !hasOnlyKeys(sample, sampleFields)) {
      return false;
    }
    return Object.entries(sample).every(([key, value]) => {
      if (key === 'stackSummary') {
        return (
          Array.isArray(value) &&
          value.length <= 32 &&
          value.every((line) => isBoundedString(line, 240))
        );
      }
      return isBoundedString(value, key === 'message' ? 1_000 : 240);
    });
  }

  function validOutcome(outcome) {
    return (
      isPlainObject(outcome) &&
      hasOnlyKeys(outcome, outcomeFields) &&
      isIsoDate(outcome.at) &&
      isBoundedString(outcome.detail, 500) &&
      isBoundedString(outcome.type, 80) &&
      (outcome.prUrl === undefined || isBoundedString(outcome.prUrl, 500))
    );
  }

  function validDraftPr(draftPr) {
    return (
      draftPr === null ||
      (isPlainObject(draftPr) &&
        hasOnlyKeys(draftPr, draftPrFields) &&
        isIsoDate(draftPr.openedAt) &&
        (draftPr.branch === undefined ||
          isBoundedString(draftPr.branch, 160)) &&
        isBoundedString(draftPr.url, 500) &&
        draftPr.url.length > 0)
    );
  }

  function validCaseRecord(key, item) {
    return (
      isBoundedString(key, 300) &&
      isPlainObject(item) &&
      hasOnlyKeys(item, caseFields) &&
      item.key === key &&
      ['category', 'fingerprint', 'source'].every((field) =>
        isBoundedString(item[field], 120)
      ) &&
      (item.firstSeen === '' || isIsoDate(item.firstSeen)) &&
      (item.lastSeen === '' || isIsoDate(item.lastSeen)) &&
      isBoundedString(item.observationMarker, 120) &&
      caseStatuses.has(item.status) &&
      isNonnegativeInteger(item.totalObservations) &&
      isNonnegativeInteger(item.observedOccurrences) &&
      isNonnegativeInteger(item.recurrenceCount) &&
      Array.isArray(item.samples) &&
      item.samples.length <= maxSamples &&
      item.samples.every(validSample) &&
      Array.isArray(item.outcomes) &&
      item.outcomes.length <= maxOutcomes &&
      item.outcomes.every(validOutcome) &&
      validDraftPr(item.draftPr)
    );
  }

  return function isValidState(state) {
    return (
      isPlainObject(state) &&
      hasOnlyKeys(state, stateFields) &&
      state.version === version &&
      isPlainObject(state.cases) &&
      Object.keys(state.cases).length <= maxCases &&
      Object.entries(state.cases).every(([key, item]) =>
        validCaseRecord(key, item)
      ) &&
      isPlainObject(state.fairness) &&
      hasOnlyKeys(state.fairness, fairnessFields) &&
      isBoundedString(state.fairness.lastCategory, 80) &&
      (state.fairness.draftPrCursor === undefined ||
        isBoundedString(state.fairness.draftPrCursor, 300))
    );
  };
}
