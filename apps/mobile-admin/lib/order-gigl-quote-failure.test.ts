import { describe, expect, it } from 'vitest';
import { resolveOrderGiglQuoteFailure } from './order-gigl-quote-failure';

describe('resolveOrderGiglQuoteFailure', () => {
  it('preserves the server-reported missing address fields', () => {
    expect(
      resolveOrderGiglQuoteFailure({
        code: 'ORDER_SHIPPING_ADDRESS_INCOMPLETE',
        message: 'Incomplete',
        missing: ['city', 'state'],
      })
    ).toEqual({ kind: 'missing_address', missing: ['city', 'state'] });
  });

  it('uses an Error message for ordinary quote failures', () => {
    expect(resolveOrderGiglQuoteFailure(new Error('Provider offline'))).toEqual(
      { kind: 'error', message: 'Provider offline' }
    );
  });

  it('returns a safe fallback for non-Error failures', () => {
    expect(resolveOrderGiglQuoteFailure(null)).toEqual({
      kind: 'error',
      message: 'GIG shipping is temporarily unavailable.',
    });
  });
});
