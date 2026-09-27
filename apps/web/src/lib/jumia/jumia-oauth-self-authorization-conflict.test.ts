import { describe, expect, it } from 'vitest';
import {
  getActiveSelfAuthorizedJumiaShopIds,
  getJumiaOAuthShopIdsConflictingWithSelfAuthorization,
} from './jumia-oauth-self-authorization-conflict';

describe('jumia oauth self-authorization conflict helpers', () => {
  it('collects active self-authorized shop ids', () => {
    const shopIds = getActiveSelfAuthorizedJumiaShopIds([
      {
        shop_id: 'shop-1',
        is_active: true,
        connection_method: 'self_authorization',
      },
      {
        shop_id: 'shop-2',
        is_active: false,
        connection_method: 'self_authorization',
      },
      {
        shop_id: 'shop-3',
        is_active: true,
        connection_method: 'oauth',
      },
    ]);

    expect([...shopIds]).toEqual(['shop-1']);
  });

  it('detects oauth shop ids that already have self-authorization', () => {
    const conflicts = getJumiaOAuthShopIdsConflictingWithSelfAuthorization(
      ['shop-1', 'shop-2'],
      new Set(['shop-2'])
    );

    expect(conflicts).toEqual(['shop-2']);
  });
});
