import { describe, expect, it } from 'vitest';
import { requiresPushOutcomeReview } from './scheduled-notification-push-outcome-review.ts';

describe('requiresPushOutcomeReview', () => {
  it('does not require review when the outbox has only terminal rejected tickets', () => {
    expect(
      requiresPushOutcomeReview({
        accepted: 0,
        dispatching: 0,
        rejected: 2,
        unknown: 0,
      })
    ).toBe(false);
  });

  it('requires review for ambiguous or still-dispatching tickets', () => {
    expect(requiresPushOutcomeReview({ dispatching: 1, unknown: 0 })).toBe(
      true
    );
    expect(requiresPushOutcomeReview({ dispatching: 0, unknown: 1 })).toBe(
      true
    );
  });

  it('defers finalization while quiet-hour tokens remain pending', () => {
    expect(
      requiresPushOutcomeReview({ pending: 1, dispatching: 0, unknown: 0 })
    ).toBe(true);
  });
});
