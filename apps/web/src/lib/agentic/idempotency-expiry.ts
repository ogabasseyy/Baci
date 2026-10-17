export const IDEMPOTENCY_IN_PROGRESS_TTL_MS = 2 * 60 * 1000;

export function isStaleInProgressReservation(
  record: { updated_at?: unknown },
  now: Date
): boolean {
  if (typeof record.updated_at !== 'string') {
    return false;
  }

  const updatedAt = new Date(record.updated_at);
  if (!Number.isFinite(updatedAt.getTime())) {
    return false;
  }

  return now.getTime() - updatedAt.getTime() >= IDEMPOTENCY_IN_PROGRESS_TTL_MS;
}
