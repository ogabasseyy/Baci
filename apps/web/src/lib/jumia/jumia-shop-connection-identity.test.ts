import { describe, expect, it } from 'vitest';
import {
  buildExistingJumiaShopIds,
  isJumiaShopAlreadyConnected,
} from './jumia-shop-connection-identity';

describe('jumiaShopConnectionIdentities', () => {
  it('treats OAuth-connected shops as already connected by raw shop id', () => {
    const existing = buildExistingJumiaShopIds([
      {
        shop_id: 'shop-1',
        country_code: 'NG',
        marketplace_key: 'oauth',
        connection_method: 'oauth',
      },
    ]);

    expect(
      isJumiaShopAlreadyConnected(
        {
          id: 'shop-1',
          name: 'Shop One',
          countryCode: 'NG',
          marketplace: 'Jumia Nigeria',
        },
        existing
      )
    ).toBe(true);
  });

  it('matches self-authorization selections by business client code', () => {
    const existing = buildExistingJumiaShopIds([
      {
        shop_id: 'shop-1',
        country_code: 'NG',
        marketplace_key: 'NG-RETAIL',
        connection_method: 'self_authorization',
      },
    ]);

    expect(
      isJumiaShopAlreadyConnected(
        {
          id: 'shop-1',
          selectionKey: 'shop-1:NG-RETAIL',
          businessClientCode: 'NG-RETAIL',
          name: 'Shop One',
          countryCode: 'NG',
          marketplace: 'Jumia Nigeria Retail',
        },
        existing
      )
    ).toBe(true);
  });

  it('does not block unconnected business clients under the same shop', () => {
    const existing = buildExistingJumiaShopIds([
      {
        shop_id: 'shop-1',
        country_code: 'NG',
        marketplace_key: 'NG-RETAIL',
        connection_method: 'self_authorization',
      },
    ]);

    expect(
      isJumiaShopAlreadyConnected(
        {
          id: 'shop-1',
          selectionKey: 'shop-1:NG-EXPRESS',
          businessClientCode: 'NG-EXPRESS',
          name: 'Shop One Express',
          countryCode: 'NG',
          marketplace: 'Jumia Nigeria Express',
        },
        existing
      )
    ).toBe(false);
  });
});
