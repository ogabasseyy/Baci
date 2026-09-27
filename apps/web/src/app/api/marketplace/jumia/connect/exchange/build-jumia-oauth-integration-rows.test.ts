import { describe, expect, it } from 'vitest';
import { buildJumiaOAuthIntegrationRows } from './build-jumia-oauth-integration-rows';

describe('buildJumiaOAuthIntegrationRows', () => {
  it('maps discovered shops into oauth integration rows', () => {
    const rows = buildJumiaOAuthIntegrationRows({
      merchantId: 'merchant-1',
      shops: [
        {
          id: 'shop-1',
          name: 'Shop One',
          businessClients: [{ countryCode: 'NG' }],
        },
      ],
      tokens: { access_token: 'access', refresh_token: 'refresh' },
      tokenExpiresAt: new Date('2026-08-21T00:00:00.000Z'),
      isFallbackShop: false,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        marketplace_key: 'oauth',
        connection_method: 'oauth',
        jumia_authorization_id: null,
        is_active: true,
        refresh_token: 'refresh',
      }),
    ]);
  });
});
