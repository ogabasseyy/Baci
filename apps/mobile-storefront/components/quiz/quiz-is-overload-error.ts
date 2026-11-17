/** True for a rate-limited (429) or overloaded (503) response error. */
export function isOverloadError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { status } = error as { status?: unknown };
  return status === 429 || status === 503;
}
