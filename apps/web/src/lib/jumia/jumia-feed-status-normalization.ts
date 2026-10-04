const ACCEPTED_FEED_STATUSES = new Set([
  'approved',
  'active',
  'complete',
  'completed',
  'created',
  'success',
  'successful',
]);

const FAILED_FEED_STATUSES = new Set([
  'failed',
  'failure',
  'error',
  'rejected',
  'invalid',
  'unsuccessful',
]);

function normalizeFeedStatus(status: string): string {
  return status.trim().toLowerCase();
}

export function isAcceptedFeedStatus(status: string): boolean {
  return ACCEPTED_FEED_STATUSES.has(normalizeFeedStatus(status));
}

export function isFailedFeedStatus(status: string): boolean {
  return FAILED_FEED_STATUSES.has(normalizeFeedStatus(status));
}
