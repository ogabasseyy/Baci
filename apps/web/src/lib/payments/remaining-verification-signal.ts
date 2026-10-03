/** Leave an unstarted provider check for the next worker pass at its deadline. */
export function remainingVerificationSignal(
  deadlineMs: number | undefined
): AbortSignal | null | undefined {
  if (deadlineMs === undefined) return undefined;
  const remainingMs = deadlineMs - Date.now();
  return remainingMs <= 0 ? null : AbortSignal.timeout(remainingMs);
}
