import { describe, expect, it } from 'vitest';
import { blocksShippingQuoteReplacement } from './merchant-shipping-charge-quote-guard';

describe('active shipping charge quote replacement guard', () => {
  it.each([
    'reserved',
    'provider_submitting',
    'needs_reconciliation',
  ])('blocks replacement while charge is %s', (status) => {
    expect(
      blocksShippingQuoteReplacement({
        previousQuoteId: 'old',
        nextQuoteId: 'new',
        chargeStatuses: [status],
      })
    ).toBe(true);
  });
  it('allows idempotent updates to the same quote', () => {
    expect(
      blocksShippingQuoteReplacement({
        previousQuoteId: 'same',
        nextQuoteId: 'same',
        chargeStatuses: ['reserved'],
      })
    ).toBe(false);
  });
  it('allows replacement after refund', () => {
    expect(
      blocksShippingQuoteReplacement({
        previousQuoteId: 'old',
        nextQuoteId: 'new',
        chargeStatuses: ['refunded'],
      })
    ).toBe(false);
  });

  it.each(['booked', 'unknown'])('fails closed for %s status', (status) => {
    expect(
      blocksShippingQuoteReplacement({
        previousQuoteId: 'old',
        nextQuoteId: 'new',
        chargeStatuses: [status],
      })
    ).toBe(true);
  });
});
