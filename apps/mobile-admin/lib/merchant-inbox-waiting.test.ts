import { describe, expect, it } from 'vitest';
import { isWaitingLong } from './merchant-inbox-waiting';

const now = new Date('2026-11-24T12:00:00Z');

describe('isWaitingLong', () => {
  it('is false within the first day', () => {
    expect(isWaitingLong('2026-11-23T13:00:00Z', now)).toBe(false);
  });

  it('is false at exactly one day and true just past it', () => {
    expect(isWaitingLong('2026-11-23T12:00:00Z', now)).toBe(false);
    expect(isWaitingLong('2026-11-23T11:59:59Z', now)).toBe(true);
  });

  it('is true for a chat that has waited several days', () => {
    expect(isWaitingLong('2026-11-20T09:00:00Z', now)).toBe(true);
  });

  it('is false when there is no time or it cannot be read', () => {
    expect(isWaitingLong(null, now)).toBe(false);
    expect(isWaitingLong('not a date', now)).toBe(false);
  });
});
