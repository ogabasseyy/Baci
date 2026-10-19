/** Rejected Expo tickets are terminal per-token outcomes, not delivery retries. */
export function requiresPushOutcomeReview(summary: unknown): boolean {
  if (!isRecord(summary)) return false;
  return (
    hasPositiveCount(summary.unknown) ||
    hasPositiveCount(summary.dispatching) ||
    hasPositiveCount(summary.pending)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function hasPositiveCount(value: unknown): boolean {
  return typeof value === 'number' && value > 0;
}
