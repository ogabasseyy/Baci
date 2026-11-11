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

  it.each([
    [
      'a negative remaining amount',
      { currency: 'NGN', inFlightAmount: 0, remainingAmount: -1 },
    ],
    [
      'a NaN in-flight amount',
      { currency: 'NGN', inFlightAmount: Number.NaN, remainingAmount: 1 },
    ],
    [
      'a blank currency',
      { currency: '', inFlightAmount: 0, remainingAmount: 1 },
    ],
    ['a non-object', 'oops'],
  ])('reports unknown without amounts for %s', (_name, refundDetails) => {
    expect(
      readCancellationRefundResult({
        sideEffects: { refund: 'manual_required', refundDetails },
      })
    ).toEqual({ refund_outcome: 'unknown' });
  });
});
