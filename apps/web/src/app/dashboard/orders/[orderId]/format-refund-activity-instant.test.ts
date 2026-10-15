import { describe, expect, it } from 'vitest';
import { formatRefundActivityInstant } from './format-refund-activity-instant';

describe('formatRefundActivityInstant', () => {
  it('formats a valid instant with the locale string', () => {
    expect(formatRefundActivityInstant('2026-09-28T12:00:00Z')).toBe(
      new Date('2026-09-28T12:00:00Z').toLocaleString()
    );
  });
  it('falls back on malformed or missing values', () => {
    expect(formatRefundActivityInstant('not-a-date')).toBe('Date unavailable');
    expect(formatRefundActivityInstant(null)).toBe('Date unavailable');
    expect(formatRefundActivityInstant(undefined)).toBe('Date unavailable');
  });
});
