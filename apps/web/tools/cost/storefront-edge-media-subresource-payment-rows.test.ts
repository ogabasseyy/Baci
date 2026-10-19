import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_MEDIA_SUBRESOURCE_PAYMENT_ROWS } from './storefront-edge-media-subresource-payment-rows';

describe('storefront edge media subresource payment rows', () => {
  it('exports checkout, BNPL, and payment logo rows', () => {
    expect(
      STOREFRONT_EDGE_MEDIA_SUBRESOURCE_PAYMENT_ROWS.length
    ).toBeGreaterThan(0);
  });

  it('binds paystack asset and checkout rows to reviewed sources', () => {
    const byId = new Map(
      STOREFRONT_EDGE_MEDIA_SUBRESOURCE_PAYMENT_ROWS.map((r) => [r.id, r])
    );
    expect(
      byId.get('automatic-subresource:checkout-payment-paystack')?.sourcePath
    ).toBe(
      'apps/web/src/components/storefront/ogabassey/components/PaymentLogos.tsx'
    );
    expect(
      byId.get('automatic-subresource:utility-checkout-paystack-navigation')
        ?.sourcePath
    ).toBe(
      'apps/web/src/components/storefront/ogabassey/components/utility-checkout.ts'
    );
  });
});
