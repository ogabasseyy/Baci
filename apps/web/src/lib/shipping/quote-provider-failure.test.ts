import { describe, expect, it } from 'vitest';
import { quoteProviderFailure } from './quote-provider-failure';
import type { ShippingQuote } from './types';

describe('quoteProviderFailure', () => {
  it('associates a provider failure with only the marked result', () => {
    const failedResult: ShippingQuote[] = [];
    const successfulEmptyResult: ShippingQuote[] = [];

    expect(
      quoteProviderFailure.mark(failedResult, new Error('provider unavailable'))
    ).toBe(failedResult);
    expect(quoteProviderFailure.get(failedResult)?.message).toBe(
      'provider unavailable'
    );
    expect(quoteProviderFailure.get(successfulEmptyResult)).toBeUndefined();
  });

  it('normalizes non-Error rejection reasons', () => {
    const failedResult: ShippingQuote[] = [];

    quoteProviderFailure.mark(failedResult, 'unstructured failure');

    expect(quoteProviderFailure.get(failedResult)?.message).toBe(
      'Unknown shipping provider failure'
    );
  });
});
