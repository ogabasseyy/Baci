import { describe, expect, it } from 'vitest';
import {
  throwIfVtuRefundUnconfirmed,
  type VtuRefundGuardRow,
} from './vtu-refund-guard';

function row(overrides: Partial<VtuRefundGuardRow> = {}): VtuRefundGuardRow {
  return {
    amount: 1000,
    customer_id: 'customer-1',
    id: 'vtu-1',
    source: 'checkout',
    ...overrides,
  };
}

describe('throwIfVtuRefundUnconfirmed', () => {
  it('throws RetryableVtuError when a checkout refund is required but unconfirmed', () => {
    let caught: unknown;
    try {
      throwIfVtuRefundUnconfirmed({
        row: row(),
        refundIssued: false,
        refundedAmount: 0,
        failedMessage: 'vend failed',
        failedMetadata: {},
        message: 'Unable to confirm VTU refund for failed purchase vtu-1',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      name: 'RetryableVtuError',
      context: {
        failedMessage: 'vend failed',
        refundedAmount: 0,
        transactionId: 'vtu-1',
      },
    });
  });

  it('is a no-op when the refund was issued', () => {
    expect(() =>
      throwIfVtuRefundUnconfirmed({
        row: row(),
        refundIssued: true,
        refundedAmount: 1000,
        message: 'unused',
      })
    ).not.toThrow();
  });

  it('is a no-op when no customer refund is required', () => {
    expect(() =>
      throwIfVtuRefundUnconfirmed({
        row: row({ customer_id: null }),
        refundIssued: false,
        refundedAmount: 0,
        message: 'unused',
      })
    ).not.toThrow();
  });

  it('is a no-op for non-checkout sources', () => {
    expect(() =>
      throwIfVtuRefundUnconfirmed({
        row: row({ source: 'loyalty_reward' }),
        refundIssued: false,
        refundedAmount: 0,
        message: 'unused',
      })
    ).not.toThrow();
  });
});
