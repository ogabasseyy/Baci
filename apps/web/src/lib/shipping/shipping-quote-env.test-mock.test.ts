import { describe, expect, it } from 'vitest';
import { shippingQuoteEnvTestMock } from './shipping-quote-env.test-mock';

describe('shippingQuoteEnvTestMock', () => {
  it('returns a non-empty service role key for quote proof tests', () => {
    expect(shippingQuoteEnvTestMock.getSupabaseServiceRoleKey()).toHaveLength(
      32
    );
  });
});
