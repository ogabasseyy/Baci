import { describe, expect, it } from 'vitest';
import { formatRefundActivityInstant } from './format-refund-activity-instant';

describe('formatRefundActivityInstant', () => {
  it('formats a valid instant deterministically across runtime zones', () => {
    // Pinned Lagos rendering: server and client must produce the
    // identical string or hydration mismatches outside the server
    // zone. Run the suite under TZ=Pacific/Auckland to prove it.
    expect(formatRefundActivityInstant('2026-09-28T12:00:00Z')).toBe(
      '28 Sept 2026, 13:00'
    );
  });
  it('falls back on malformed or missing values', () => {
    expect(formatRefundActivityInstant('not-a-date')).toBe('Date unavailable');
    expect(formatRefundActivityInstant(null)).toBe('Date unavailable');
    expect(formatRefundActivityInstant(undefined)).toBe('Date unavailable');
  });
});
