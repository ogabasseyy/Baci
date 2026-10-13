export const remediationObservationFor = (candidate) =>
  `${candidate?.lastSeen || 'observed'}:${Number(candidate?.occurrences || 0)}`;

const legacyRemediationObservationFor = (candidate) =>
  String(candidate?.lastSeen || candidate?.occurrences || 'observed');

export const remediationStateKeyFor = (candidate) =>
  String(candidate?.caseKey || candidate?.fingerprint || '');

export function matchingHandledEntry(handled, candidate) {
  const own = (key) => (Object.hasOwn(handled, key) ? handled[key] : undefined);
  const stateKey = remediationStateKeyFor(candidate);
  const canonical = stateKey ? own(stateKey) : undefined;
  const legacy = own(String(candidate?.fingerprint || ''));
  const entry = canonical || legacy;
  if (!entry) return null;
  return [
    remediationObservationFor(candidate),
    legacyRemediationObservationFor(candidate),
  ].includes(entry.observation)
    ? entry
    : null;
}
