import { describe, expect, it } from 'vitest';
import { readCancellationRefundResult } from './cancellation-refund-result';

describe('readCancellationRefundResult', () => {
  it('reads the outcome and details the server reports', () => {
    expect(
      readCancellationRefundResult({
        sideEffects: {
          refund: 'manual_required',
          refundDetails: {
            currency: 'NGN',
            inFlightAmount: 2000,
            remainingAmount: 3000,
          },
        },
      })
    ).toEqual({
      refund_details: {
        currency: 'NGN',
        inFlightAmount: 2000,
        remainingAmount: 3000,
      },
      refund_outcome: 'manual_required',
    });
  });

  it.each([
    undefined,
    null,
    'x',
    {},
    { sideEffects: 'x' },
  ])('returns nothing for a body without side effects (%j)', (payload) => {
    expect(readCancellationRefundResult(payload)).toEqual({});
  });
});
