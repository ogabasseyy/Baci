/**
 * Interleave wedge mains with filing-only retries (mains first).
 * Transient mains repeat with the same updated_at every sweep, so
 * appending all retries after a full main batch lets the deadline
 * stop the pass before any filing-only retry runs, and completed
 * captures carrying the retry marker never file their operations
 * review.
 */
export function interleaveWedgeCandidates<T>(mains: T[], retries: T[]): T[] {
  const candidates: T[] = [];
  for (
    let index = 0;
    index < Math.max(mains.length, retries.length);
    index += 1
  ) {
    if (index < mains.length) candidates.push(mains[index]);
    if (index < retries.length) candidates.push(retries[index]);
  }
  return candidates;
}
