import { describe, expect, it } from '@jest/globals';
import { createQuizTerminalContext } from './quiz-v2-terminal-context';

describe('createQuizTerminalContext', () => {
  it('preserves the attempt and server timing context', () => {
    expect(
      createQuizTerminalContext(
        'attempt-1',
        'event-1',
        '2026-08-04T12:05:00.000Z',
        '2026-08-04T12:00:00.000Z'
      )
    ).toEqual({
      attemptId: 'attempt-1',
      eventId: 'event-1',
      eventEndsAt: '2026-08-04T12:05:00.000Z',
      serverNow: '2026-08-04T12:00:00.000Z',
      contractVersion: 2,
    });
  });
});
