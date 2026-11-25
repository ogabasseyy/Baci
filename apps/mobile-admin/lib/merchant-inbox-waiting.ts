/** A shopper's message left unanswered for a whole day is overdue. */
export const WAITING_LONG_MS = 24 * 60 * 60 * 1000;

/** True when `since` was more than a day before `now`. */
export function isWaitingLong(
  since: string | null,
  now: Date = new Date()
): boolean {
  if (!since) return false;
  const at = new Date(since).getTime();
  if (Number.isNaN(at)) return false;
  return now.getTime() - at > WAITING_LONG_MS;
}
