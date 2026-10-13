const QUIET_AFTER_MS = 7 * 24 * 60 * 60 * 1_000;

const isIsoDate = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

export function quietStaleRemediationCases(state, nowMs) {
  for (const item of Object.values(state.cases)) {
    if (
      !['legacy_handled', 'quiet'].includes(item.status) &&
      isIsoDate(item.lastSeen) &&
      nowMs - Date.parse(item.lastSeen) >= QUIET_AFTER_MS
    ) {
      item.status = 'quiet';
    }
  }
}
