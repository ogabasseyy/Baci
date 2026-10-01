import { describe, expect, it } from '@jest/globals';
import { resultLifecycle } from './quiz-v2-result-lifecycle';

describe('resultLifecycle', () => {
  it('keeps pending results pollable and cancellation explicit', () => {
    expect(
      resultLifecycle({
        attemptId: 'a',
        availability: 'pending',
        availableAt: null,
      })
    ).toBe('pending_results');
    expect(
      resultLifecycle({
        attemptId: 'a',
        availability: 'unavailable',
        reason: 'event_cancelled',
      })
    ).toBe('event_cancelled');
  });

  it('falls back to the final lifecycle for a published result', () => {
    expect(
      resultLifecycle({
        attemptId: 'a',
        availability: 'unavailable',
        reason: 'not_found',
      })
    ).toBe('final');
  });
});
