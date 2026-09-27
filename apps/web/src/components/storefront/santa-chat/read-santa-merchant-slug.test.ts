import { describe, expect, it } from 'vitest';
import { SANTA_MERCHANT_SLUG_HEADER } from '@/lib/agentic/santa-merchant-slug-header';
import { readSantaMerchantSlug } from './read-santa-merchant-slug';

describe('readSantaMerchantSlug', () => {
  it('returns a valid resolved tenant slug from the response header', () => {
    const response = new Response(null, {
      headers: { [SANTA_MERCHANT_SLUG_HEADER]: 'winter-store' },
    });

    expect(readSantaMerchantSlug(response)).toBe('winter-store');
  });

  it('rejects missing, blank, and unsafe tenant headers', () => {
    expect(readSantaMerchantSlug(new Response())).toBeNull();
    expect(
      readSantaMerchantSlug(
        new Response(null, {
          headers: { [SANTA_MERCHANT_SLUG_HEADER]: '   ' },
        })
      )
    ).toBeNull();
    expect(
      readSantaMerchantSlug(
        new Response(null, {
          headers: { [SANTA_MERCHANT_SLUG_HEADER]: '../checkout' },
        })
      )
    ).toBeNull();
  });
});
