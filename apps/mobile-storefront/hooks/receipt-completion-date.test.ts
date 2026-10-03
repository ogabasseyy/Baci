import { describe, expect, it } from '@jest/globals';
import { selectReceiptCompletionDate } from './receipt-completion-date';

describe('selectReceiptCompletionDate', () => {
  it('returns null without rows', () => {
    expect(selectReceiptCompletionDate(undefined)).toBeNull();
    expect(selectReceiptCompletionDate(null)).toBeNull();
    expect(selectReceiptCompletionDate([])).toBeNull();
  });

  it('selects the newest settled payment', () => {
    expect(
      selectReceiptCompletionDate([
        {
          transaction_type: 'payment',
          status: 'completed',
          created_at: '2026-09-30T12:00:00.000Z',
        },
        {
          transaction_type: 'payment',
          status: 'success',
          created_at: '2026-10-05T12:00:00.000Z',
        },
      ])
    ).toBe('2026-10-05T12:00:00.000Z');
  });

  it('skips unsettled, non-payment, and corrupt rows', () => {
    expect(
      selectReceiptCompletionDate([
        null,
        undefined,
        42,
        {
          transaction_type: 'refund',
          status: 'completed',
          created_at: '2026-10-06T12:00:00.000Z',
        },
        {
          transaction_type: 'payment',
          status: 'pending',
          created_at: '2026-10-06T12:00:00.000Z',
        },
        {
          transaction_type: 'payment',
          status: 'completed',
          created_at: 'not-a-date',
        },
        {
          transaction_type: 'payment',
          status: 'completed',
          created_at: 1720000000,
        },
        {
          transaction_type: 'payment',
          status: 'completed',
          created_at: '2026-09-30T12:00:00.000Z',
        },
      ])
    ).toBe('2026-09-30T12:00:00.000Z');
  });
});
