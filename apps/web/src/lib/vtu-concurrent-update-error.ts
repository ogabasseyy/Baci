/**
 * Zero-match signal for status/token-gated VTU writes: another
 * worker moved the row, so the loser must resolve the current row
 * instead of writing. Extracted from `vtu-fulfillment.ts` (Codex
 * R97 P1) so the Kuda fallback marker can throw it without an
 * import cycle (fulfillment already imports the fallback).
 */
export class VtuConcurrentUpdateError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, VtuConcurrentUpdateError.prototype);
    this.name = 'VtuConcurrentUpdateError';
  }
}

export function isVtuConcurrentUpdateError(
  error: unknown
): error is VtuConcurrentUpdateError {
  return error instanceof VtuConcurrentUpdateError;
}
