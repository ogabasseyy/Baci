import { describe, expect, it } from '@jest/globals';
import { isQuizOpenAtServerTime } from './quiz-v2-server-clock';

describe('isQuizOpenAtServerTime', () => {
  it('uses serverNow rather than the device clock', () => {
    expect(
      isQuizOpenAtServerTime({
        availability: 'active',
        eventEndsAt: '2026-08-04T12:05:00.000Z',
        serverNow: '2026-08-04T12:00:00.000Z',
      })
    ).toBe(true);
    expect(
      isQuizOpenAtServerTime({
        availability: 'active',
        eventEndsAt: '2026-08-04T12:05:00.000Z',
        serverNow: '2026-08-04T12:05:00.000Z',
      })
    ).toBe(false);
  });

  it('returns false when the server omits either timestamp', () => {
    expect(
      isQuizOpenAtServerTime({
        availability: 'active',
        eventEndsAt: null,
        serverNow: '2026-08-04T12:00:00.000Z',
      })
    ).toBe(false);
  });
});
