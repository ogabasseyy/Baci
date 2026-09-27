/**
 * Thrown when Jumia accepted the feed but local persistence failed. Carries
 * the accepted feed ids so the caller can surface the reconciliation handle
 * instead of reporting a bare failure.
 */
export class JumiaPartialUpdateError extends Error {
  feedIds: string[];

  constructor(message: string, feedIds: string[]) {
    super(message);
    this.name = 'JumiaPartialUpdateError';
    this.feedIds = feedIds;
  }
}
