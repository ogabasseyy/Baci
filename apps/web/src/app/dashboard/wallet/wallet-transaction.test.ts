import { describe, expect, it } from 'vitest';
import { mapWalletTransaction } from './wallet-transaction';

describe('mapWalletTransaction', () => {
  it('preserves supported refund and processing ledger values', () => {
    expect(
      mapWalletTransaction({
        amount: '700.00',
        balance_after: '5700.50',
        created_at: '2026-08-05T10:00:00.000Z',
        description: 'Order refund',
        id: 'wallet-refund-1',
        status: 'processing',
        type: 'refund',
      })
    ).toEqual({
      amount: 700,
      balanceAfter: 5700.5,
      createdAt: '2026-08-05T10:00:00.000Z',
      description: 'Order refund',
      id: 'wallet-refund-1',
      status: 'processing',
      type: 'refund',
    });
  });

  it('uses safe display defaults for unknown legacy values', () => {
    expect(
      mapWalletTransaction({
        amount: 0,
        balance_after: 0,
        created_at: null,
        description: null,
        id: 'legacy-row',
        status: 'unknown',
        type: 'unknown',
      })
    ).toEqual(
      expect.objectContaining({
        createdAt: '',
        description: '',
        status: 'pending',
        type: 'credit',
      })
    );
  });
});
