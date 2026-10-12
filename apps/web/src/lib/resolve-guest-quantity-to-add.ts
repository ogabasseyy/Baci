/**
 * Additive-only transfer: tops a website line up to the handoff target but
 * never shrinks or deletes it, so chat-side removals or quantity decreases
 * do not propagate to an already-transferred website cart.
 */
export function resolveGuestQuantityToAdd(
  target: number | undefined,
  existing: number,
  fallback: number
): number {
  if (target === undefined) return fallback;
  return Math.max(0, target - existing);
}
