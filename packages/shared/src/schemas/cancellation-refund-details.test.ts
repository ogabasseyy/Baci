import { describe, expect, it } from 'vitest';
import { readCancellationSideEffects } from './cancellation-refund-details';

const valid = { currency: 'NGN', inFlightAmount: 2000, remainingAmount: 3000 };

describe('readCancellationSideEffects', () => {
  it('returns the outcome and validated details', () => {
    expect(
      readCancellationSideEffects({
        refund: 'manual_required',
        refundDetails: valid,
      })
    ).toEqual({ details: valid, outcome: 'manual_required' });
  });

  it('keeps an outcome that carries no details', () => {
    expect(
      readCancellationSideEffects({ refund: 'queued_if_required' })
    ).toEqual({ outcome: 'queued_if_required' });
  });

  it.each([
    undefined,
    null,
    'x',
    1,
  ])('ignores non-object side effects (%j)', (v) => {
    expect(readCancellationSideEffects(v)).toEqual({});
  });

  it.each([
    ['negative amount', { ...valid, remainingAmount: -1 }],
    ['negative in-flight', { ...valid, inFlightAmount: -5 }],
    ['NaN amount', { ...valid, remainingAmount: Number.NaN }],
    ['infinite amount', { ...valid, inFlightAmount: Number.POSITIVE_INFINITY }],
    ['string amount', { ...valid, remainingAmount: '3000' }],
    ['missing amount', { currency: 'NGN', inFlightAmount: 1 }],
    ['blank currency', { ...valid, currency: '  ' }],
    ['null currency', { ...valid, currency: null }],
    ['non-object details', 'oops'],
  ])('treats %s as unknown and drops the details', (_name, refundDetails) => {
    expect(
      readCancellationSideEffects({ refund: 'manual_required', refundDetails })
    ).toEqual({ outcome: 'unknown' });
  });
});
