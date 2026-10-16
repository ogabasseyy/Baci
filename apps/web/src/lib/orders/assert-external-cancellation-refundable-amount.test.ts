import { describe, expect, it } from 'vitest';
import { assertExternalCancellationRefundableAmount } from './assert-external-cancellation-refundable-amount';

function leg(amount: unknown) {
  return { amount } as never;
}

describe('assertExternalCancellationRefundableAmount', () => {
  it('returns quietly for internal-only orders with no external legs', () => {
    expect(() => assertExternalCancellationRefundableAmount([])).not.toThrow();
  });
  it('passes legs with a safe positive total', () => {
    expect(() =>
      assertExternalCancellationRefundableAmount([leg(100), leg(50)])
    ).not.toThrow();
  });
  it('throws when the legs sum to nothing refundable', () => {
    expect(() => assertExternalCancellationRefundableAmount([leg(0)])).toThrow(
      'Completed payment transaction has no refundable amount'
    );
  });
  it('throws on non-finite or non-positive legs', () => {
    expect(() =>
      assertExternalCancellationRefundableAmount([leg(100), leg(Number.NaN)])
    ).toThrow('Completed payment transaction has no refundable amount');
    expect(() => assertExternalCancellationRefundableAmount([leg(-5)])).toThrow(
      'Completed payment transaction has no refundable amount'
    );
  });
});
