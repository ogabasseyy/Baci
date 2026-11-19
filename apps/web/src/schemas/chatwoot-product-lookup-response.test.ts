import { describe, expect, it } from 'vitest';
import { chatwootProductLookupResponseSchema } from './chatwoot-product-lookup-response';

describe('Chatwoot product lookup response schema', () => {
  it('accepts a valid product payload and an uncorrelated invalid_request failure', () => {
    expect(
      chatwootProductLookupResponseSchema.safeParse({
        ok: true,
        requestId: 'req_1',
        product: {
          availability: 'in_stock',
          currency: 'NGN',
          name: 'Phone',
          price: 10,
          slug: 'phone',
          variants: [],
        },
      }).success
    ).toBe(true);
    expect(
      chatwootProductLookupResponseSchema.safeParse({
        ok: false,
        code: 'invalid_request',
      }).success
    ).toBe(true);
  });

  it('rejects unknown status codes or invalid requestIds', () => {
    expect(
      chatwootProductLookupResponseSchema.safeParse({
        ok: false,
        code: 'unknown_code',
        requestId: 'req_1',
      }).success
    ).toBe(false);
    expect(
      chatwootProductLookupResponseSchema.safeParse({
        ok: false,
        code: 'product_unavailable',
        requestId: 'bad id!',
      }).success
    ).toBe(false);
  });
});
