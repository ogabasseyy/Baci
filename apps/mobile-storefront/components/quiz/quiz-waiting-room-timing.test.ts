import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { getRemainingSeconds, isTerminal } from './quiz-waiting-room-timing';
import { event } from './use-quiz-waiting-room-test-harness';

describe('getRemainingSeconds', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-23T11:59:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts whole seconds to the start', () => {
    expect(getRemainingSeconds(event(), 0)).toBe(60);
  });

  it('rounds a part second up so zero means the start has passed', () => {
    jest.setSystemTime(new Date('2026-08-23T11:59:59.001Z'));
    expect(getRemainingSeconds(event(), 0)).toBe(1);
    jest.setSystemTime(new Date('2026-08-23T12:00:00.000Z'));
    expect(getRemainingSeconds(event(), 0)).toBe(0);
  });

  it('applies the server clock offset to the phone clock', () => {
    // Phone is 10 s behind the server: 50 s left, not 60.
    expect(getRemainingSeconds(event(), 10_000)).toBe(50);
    // Phone is 10 s ahead of the server: 70 s left.
    expect(getRemainingSeconds(event(), -10_000)).toBe(70);
  });

  it('never goes below zero after the start', () => {
    jest.setSystemTime(new Date('2026-08-23T12:05:00.000Z'));
    expect(getRemainingSeconds(event(), 0)).toBe(0);
  });

  it('treats a missing or invalid start time as zero', () => {
    expect(getRemainingSeconds(event({ startsAt: null }), 0)).toBe(0);
    expect(getRemainingSeconds(event({ startsAt: 'not-a-date' }), 0)).toBe(0);
  });
});

describe('isTerminal', () => {
  it('is true for statuses that end the waiting room', () => {
    for (const status of [
      'closed',
      'completed',
      'cancelled',
      'finalizing',
    ] as const) {
      expect(isTerminal(status)).toBe(true);
    }
  });

  it('is false while the quiz can still be waited for or played', () => {
    for (const status of ['scheduled', 'active', 'open'] as const) {
      expect(isTerminal(status)).toBe(false);
    }
  });
});
