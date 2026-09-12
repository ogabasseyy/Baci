import { describe, expect, it } from 'vitest';
import { formatReceiptListDate } from './receipt-list-date';

describe('formatReceiptListDate', () => {
  it('preserves date-only values', () => {
    expect(formatReceiptListDate('2026-07-16')).toBe('7/16/2026');
  });

  it('uses Lagos calendar semantics for timestamp values', () => {
    expect(formatReceiptListDate('2026-03-04T23:30:00.000Z')).toBe('3/5/2026');
  });
});
