import { describe, expect, it } from 'vitest';
import {
  isAliasApiShapedOnRewritableHost,
  isLegacyAnalyticsConversionPath,
  isLegacyKlumpWooCommerceWebhookPath,
  matchAliasApiPrefixShape,
} from './api-alias';

describe('alias-shaped API paths', () => {
  it('accepts a merchant alias API prefix but excludes storefront route names', () => {
    expect(matchAliasApiPrefixShape('/old-shop/api/orders')).toEqual({
      prefix: 'old-shop',
      apiPathname: '/api/orders',
    });
    expect(matchAliasApiPrefixShape('/products/api/orders')).toBeNull();
    expect(
      isAliasApiShapedOnRewritableHost(
        'usebaci.com',
        matchAliasApiPrefixShape('/old-shop/api/orders')
      )
    ).toBe(true);
    expect(
      isAliasApiShapedOnRewritableHost(
        'live.usebaci.com',
        matchAliasApiPrefixShape('/old-shop/api/orders')
      )
    ).toBe(false);
  });

  it('matches retired public endpoints case-insensitively with one optional slash', () => {
    expect(isLegacyAnalyticsConversionPath('/ANALYTICS/CONVERSION/')).toBe(
      true
    );
    expect(
      isLegacyKlumpWooCommerceWebhookPath('/WC-API/KLP_WC_PAYMENT_WEBHOOK/')
    ).toBe(true);
  });
});
