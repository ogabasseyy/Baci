import { describe, expect, it } from '@jest/globals';
import type { QuizEvent } from '@/services/quiz';
import { QuizServiceError } from '@/services/quiz-types';
import {
  canPlayAnotherQuizAttempt,
  formatQuizClockWithDay,
  formatQuizTriesLeft,
  formatRemainingTime,
  formatTimeRange,
  getEventStartButtonText,
  getPrizeMomentLabel,
  getQuizErrorMessage,
  getQuizTriesLeft,
  isQuizRecoveryCurrent,
  shouldShowEventList,
} from './QuizScreen.utils';

describe('QuizScreen utils', () => {
  it('allows another attempt only while a multi-attempt event remains open', () => {
    const event: QuizEvent = {
      endsAt: '2026-08-16T12:05:00.000Z',
      id: 'event-retry',
      maxAttempts: 2,
      prizeName: 'Phone',
      questionCount: 3,
      startsAt: '2026-08-16T12:00:00.000Z',
      status: 'active',
      title: 'Retryable test',
    };

    expect(canPlayAnotherQuizAttempt(event, '2026-08-16T12:04:00.000Z')).toBe(
      true
    );
    expect(canPlayAnotherQuizAttempt(event, '2026-08-16T12:05:00.000Z')).toBe(
      false
    );
    expect(
      canPlayAnotherQuizAttempt({ ...event, maxAttempts: 1 }, event.serverNow)
    ).toBe(false);
    expect(canPlayAnotherQuizAttempt({ ...event, status: 'finalizing' })).toBe(
      false
    );
  });

  it('formats event time ranges and handles unset times', () => {
    const event: QuizEvent = {
      endsAt: '2026-05-20T11:00:00',
      id: 'event-1',
      prizeName: 'Prize',
      questionCount: 3,
      startsAt: '2026-05-20T10:00:00',
      status: 'open',
      title: 'Daily Prize Quiz',
    };

    const fallbackMessage = 'Schedule pending';

    expect(formatTimeRange(event, 'en-US', fallbackMessage)).toBe(
      '10:00 AM - 11:00 AM'
    );
    expect(
      formatTimeRange({ ...event, startsAt: null }, 'en-US', fallbackMessage)
    ).toBe(fallbackMessage);
    expect(
      formatTimeRange({ ...event, endsAt: null }, 'en-US', fallbackMessage)
    ).toBe(fallbackMessage);
    expect(
      formatTimeRange(
        { ...event, startsAt: 'not-a-date' },
        'en-US',
        fallbackMessage
      )
    ).toBe(fallbackMessage);
  });

  it('advertises free entry on the start button for an open event', () => {
    expect(getEventStartButtonText('open', false)).toBe('Play for free');
    expect(getEventStartButtonText('active', false, true)).toBe('Resume quiz');
  });

  it('uses the event timezone and server clock for the prize moment', () => {
    const event: QuizEvent = {
      endsAt: '2026-08-03T21:00:00Z',
      id: 'event-1',
      prizeName: 'Phone',
      questionCount: 20,
      startsAt: '2026-08-03T19:00:00Z',
      status: 'scheduled',
      timeZone: 'Africa/Lagos',
      title: 'Tonight quiz',
    };

    expect(getPrizeMomentLabel(event, '2026-08-03T08:00:00Z')).toBe(
      "Tonight's Prize"
    );
    expect(
      getPrizeMomentLabel(
        { ...event, startsAt: '2026-08-04T08:00:00Z' },
        '2026-08-03T08:00:00Z'
      )
    ).toBe("Tomorrow's Prize");
    expect(
      getPrizeMomentLabel(
        { ...event, startsAt: '2026-08-02T08:00:00Z' },
        '2026-08-03T08:00:00Z'
      )
    ).toBe("Today's Prize");
    expect(
      getPrizeMomentLabel(
        { ...event, startsAt: '2026-08-03T08:00:00Z', status: 'active' },
        '2026-08-03T18:00:00Z'
      )
    ).toBe("Tonight's Prize");
  });

  it('uses a Gregorian timezone date key across a local calendar boundary', () => {
    const event: QuizEvent = {
      endsAt: '2026-08-04T01:00:00Z',
      id: 'event-gregorian',
      prizeName: 'Phone',
      questionCount: 1,
      startsAt: '2026-08-04T00:30:00Z',
      status: 'scheduled',
      timeZone: 'America/Los_Angeles',
      title: 'Calendar-safe prize',
    };

    expect(
      getPrizeMomentLabel(event, '2026-08-04T00:00:00Z', 'ar-EG-u-ca-islamic')
    ).toBe("Tonight's Prize");
  });

  it('formats the universal countdown with tabular minutes and seconds', () => {
    expect(formatRemainingTime(65)).toBe('01:05');
    expect(formatRemainingTime(3661)).toBe('61:01');
    expect(formatRemainingTime(1.9)).toBe('00:01');
    expect(formatRemainingTime(-1)).toBe('00:00');
  });

  it('formats start button text for the other event states', () => {
    expect(getEventStartButtonText('open', true)).toBe('Starting...');
    expect(getEventStartButtonText('scheduled', false)).toBe('Scheduled');
    expect(getEventStartButtonText('closed', false)).toBe('Closed');
  });

  it('normalizes unknown errors to user-facing messages', () => {
    expect(
      getQuizErrorMessage(new Error('Start failed'), 'Action failed')
    ).toBe('Start failed');
    expect(getQuizErrorMessage('failed', 'Action failed')).toBe(
      'Action failed'
    );
  });

  it('hides technical quiz authorization errors behind actionable copy', () => {
    expect(
      getQuizErrorMessage(
        new QuizServiceError(
          'Quiz request is not authorized',
          'QUIZ_ROUTE_PROOF_REQUIRED',
          403
        ),
        'Quiz action failed'
      )
    ).toBe('We could not verify this quiz session. Please try again.');
  });

  it('keeps the event list out of the result state', () => {
    expect(shouldShowEventList('ready')).toBe(true);
    expect(shouldShowEventList('starting')).toBe(true);
    expect(shouldShowEventList('result')).toBe(false);
    expect(shouldShowEventList('question')).toBe(false);
    expect(shouldShowEventList('loading')).toBe(false);
  });

  it('recognizes only the active event as recovery-owned', () => {
    const state = { selectedEventId: 'event-a', status: 'result' };

    expect(isQuizRecoveryCurrent(state, 'event-a')).toBe(true);
    expect(isQuizRecoveryCurrent(state, 'event-b')).toBe(false);
    expect(
      isQuizRecoveryCurrent({ selectedEventId: null, status: 'ready' })
    ).toBe(true);
  });

  describe('bugfix: lobby closing time had no day', () => {
    const now = Date.parse('2026-11-14T20:00:00.000Z');

    it('shows only the clock time when the quiz closes today', () => {
      expect(
        formatQuizClockWithDay(
          '2026-11-14T21:30:00.000Z',
          'en-US',
          'Africa/Lagos',
          now
        )
      ).toBe('10:30 PM');
    });

    it('adds the day when the quiz closed on another day', () => {
      expect(
        formatQuizClockWithDay(
          '2026-11-12T23:34:00.000Z',
          'en-US',
          'Africa/Lagos',
          now
        )
      ).toBe('Nov 13, 12:34 AM');
    });

    it('bugfix: shows a Gregorian day for locales with another default calendar', () => {
      // th-TH defaults to the Buddhist calendar (year 2568 for 2025); the
      // day comparison is Gregorian, so the label must be too.
      const label = formatQuizClockWithDay(
        '2025-11-12T23:34:00.000Z',
        'th-TH',
        'Africa/Lagos',
        now
      );

      expect(label).toContain('2025');
      expect(label).not.toContain('2568');
    });

    it('adds the year when the quiz closed in another year', () => {
      expect(
        formatQuizClockWithDay(
          '2025-11-12T23:34:00.000Z',
          'en-US',
          'Africa/Lagos',
          now
        )
      ).toBe('Nov 13, 2025, 12:34 AM');
    });

    it('keeps the unset-time wording when there is no end time', () => {
      expect(formatQuizClockWithDay(null, 'en-US', 'Africa/Lagos', now)).toBe(
        'Time not set'
      );
    });
  });
});

describe('getQuizTriesLeft', () => {
  it('subtracts attempts used from the limit', () => {
    expect(getQuizTriesLeft({ attemptsUsed: 1, maxAttempts: 3 })).toBe(2);
  });

  it('never goes negative', () => {
    expect(getQuizTriesLeft({ attemptsUsed: 5, maxAttempts: 3 })).toBe(0);
  });

  it('is null when the count or limit is unknown', () => {
    expect(getQuizTriesLeft(undefined)).toBeNull();
    expect(getQuizTriesLeft({ maxAttempts: 3 })).toBeNull();
    expect(getQuizTriesLeft({ attemptsUsed: 1 })).toBeNull();
    expect(
      getQuizTriesLeft({ attemptsUsed: Number.NaN, maxAttempts: 3 })
    ).toBeNull();
    expect(getQuizTriesLeft({ attemptsUsed: -1, maxAttempts: 3 })).toBeNull();
    expect(getQuizTriesLeft({ attemptsUsed: 1.5, maxAttempts: 3 })).toBeNull();
  });
});

describe('formatQuizTriesLeft', () => {
  it('uses singular and plural wording', () => {
    expect(formatQuizTriesLeft(1)).toBe('1 try left');
    expect(formatQuizTriesLeft(3)).toBe('3 tries left');
  });

  it('shows nothing when unknown or exhausted', () => {
    expect(formatQuizTriesLeft(null)).toBeNull();
    expect(formatQuizTriesLeft(0)).toBeNull();
  });
});
