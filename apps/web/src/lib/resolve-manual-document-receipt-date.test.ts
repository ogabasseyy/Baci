import { describe, expect, it } from 'vitest';
import { selectReceiptCompletionDate } from './resolve-manual-document-receipt-date';

describe('selectReceiptCompletionDate', () => {
  it('selects the newest settled payment and skips unsettled rows', () => {
    expect(
      selectReceiptCompletionDate([
        {
          created_at: '2026-09-28T12:00:00Z',
          status: 'completed',
          transaction_type: 'payment',
        },
        {
          created_at: '2026-09-29T12:00:00Z',
          status: 'success',
          transaction_type: 'payment',
        },
        {
          created_at: '2026-09-30T12:00:00Z',
          status: 'pending',
          transaction_type: 'payment',
        },
        {
          created_at: '2026-09-30T12:00:00Z',
          status: 'success',
          transaction_type: 'refund',
        },
      ])
    ).toBe('2026-09-29T12:00:00Z');
  });

  it('prefers dated rows over null timestamps and empty sets', () => {
    expect(
      selectReceiptCompletionDate([
        { created_at: null, status: 'completed', transaction_type: 'payment' },
        {
          created_at: '2026-09-29T12:00:00Z',
          status: 'completed',
          transaction_type: 'payment',
        },
      ])
    ).toBe('2026-09-29T12:00:00Z');
    expect(selectReceiptCompletionDate([])).toBeNull();
    expect(
      selectReceiptCompletionDate([
        { created_at: null, status: 'completed', transaction_type: 'payment' },
      ])
    ).toBeNull();
  });
});
