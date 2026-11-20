/** Newest valid activity first; missing dates keep their relative order last. */
export function compareFollowUpDatesDesc(a: string, b: string): number {
  const timeA = Date.parse(a);
  const timeB = Date.parse(b);
  if (!Number.isFinite(timeA)) return Number.isFinite(timeB) ? 1 : 0;
  if (!Number.isFinite(timeB)) return -1;
  return timeB - timeA;
}
