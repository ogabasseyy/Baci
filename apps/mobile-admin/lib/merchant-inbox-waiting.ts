/** A shopper's message left unanswered for a whole day is overdue. */
export const WAITING_LONG_MS = 24 * 60 * 60 * 1000;

/** True when the last activity was more than a day before `now`. */
export function isWaitingLong(
  lastActivityAt: string | null,
  now: Date = new Date()
): boolean {
  if (!lastActivityAt) return false;
  const at = new Date(lastActivityAt).getTime();
  if (Number.isNaN(at)) return false;
  return now.getTime() - at > WAITING_LONG_MS;
}
