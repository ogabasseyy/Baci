import { describe, expect, it } from 'vitest';
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
          created_at: '2026-09-01T10:00:00Z',
        },
        {
          transaction_type: 'payment',
          status: 'success',
          created_at: '2026-09-02T10:00:00Z',
        },
        {
          transaction_type: 'refund',
          status: 'completed',
          created_at: '2026-09-03T10:00:00Z',
        },
      ])
    ).toBe('2026-09-02T10:00:00Z');
  });

  it('drops corrupt rows closed', () => {
    expect(
      selectReceiptCompletionDate([
        null,
        'nope',
        {
          transaction_type: 'payment',
          status: 'completed',
          created_at: 'not-a-date',
        },
        {
          transaction_type: 'payment',
          status: 'completed',
          created_at: '2026-09-01T10:00:00Z',
        },
      ])
    ).toBe('2026-09-01T10:00:00Z');
  });
});
