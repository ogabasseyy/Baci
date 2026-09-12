import { describe, expect, it } from 'vitest';
import {
  formatReceiptCurrency,
  formatReceiptDate,
  normalizeReceiptDocumentDate,
} from '@/lib/receipt-pdf-formatters';

describe('receipt pdf formatters', () => {
  it('formats dates in the merchant calendar timezone', () => {
    expect(formatReceiptDate('2026-03-22T23:30:00.000Z')).toBe('23 Mar 2026');
  });

  it('normalizes a midnight manual date to the selected Lagos calendar day', () => {
    expect(normalizeReceiptDocumentDate('2026-03-04T23:30:00.000Z')).toEqual(
      new Date('2026-03-05T00:00:00.000Z')
    );
  });

  it('preserves zero-minor-unit currency formatting', () => {
    expect(formatReceiptCurrency(150000, 'XOF')).not.toMatch(/[.,]00\b/);
  });

  it('returns a dash for invalid receipt dates', () => {
    expect(formatReceiptDate('not-a-date')).toBe('-');
  });
});
