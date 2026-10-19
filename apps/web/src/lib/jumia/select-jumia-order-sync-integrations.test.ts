import { describe, expect, it } from 'vitest';
import { selectJumiaOrderSyncIntegrations } from './select-jumia-order-sync-integrations';

describe('bugfix: disabled sibling claims order-sync scope', () => {
  it('selects a later enabled integration when an earlier sibling has orders disabled', () => {
    const selected = selectJumiaOrderSyncIntegrations([
      {
        id: 'disabled-first',
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        country_code: 'NG',
        last_sync_at: null,
        sync_config: { orders: false },
      },
      {
        id: 'enabled-second',
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        country_code: 'NG',
        last_sync_at: null,
        sync_config: { orders: true },
      },
    ]);

    expect(selected.map((row) => row.id)).toEqual(['enabled-second']);
  });

  it('keeps one enabled integration per shop+country+marketplace scope', () => {
    const selected = selectJumiaOrderSyncIntegrations([
      {
        id: 'enabled-first',
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        country_code: 'NG',
        last_sync_at: null,
        sync_config: { orders: true },
      },
      {
        id: 'enabled-duplicate',
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        country_code: 'NG',
        last_sync_at: null,
        sync_config: { orders: true },
      },
    ]);

    expect(selected.map((row) => row.id)).toEqual(['enabled-first']);
  });

  it('uses a deterministic owner and neutral cache scope for same-grant business clients', () => {
    const selected = selectJumiaOrderSyncIntegrations([
      {
        id: 'retail',
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        country_code: 'NG',
        marketplace_key: 'NG-RETAIL',
        jumia_authorization_id: 'authorization-1',
        last_sync_at: null,
        sync_config: { orders: true },
      },
      {
        id: 'express',
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        country_code: 'NG',
        marketplace_key: 'NG-EXPRESS',
        jumia_authorization_id: 'authorization-1',
        last_sync_at: null,
        sync_config: { orders: true },
      },
    ]);

    expect(selected.map((row) => row.id)).toEqual(['express']);
    expect(selected[0]?.orderSyncScope).toBe('shared');
  });

  it('keeps a shared neutral cache scope when a sibling has order sync disabled', () => {
    const selected = selectJumiaOrderSyncIntegrations([
      {
        id: 'retail-disabled',
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        country_code: 'NG',
        marketplace_key: 'NG-RETAIL',
        jumia_authorization_id: 'authorization-1',
        last_sync_at: null,
        sync_config: { orders: false },
      },
      {
        id: 'express-enabled',
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        country_code: 'NG',
        marketplace_key: 'NG-EXPRESS',
        jumia_authorization_id: 'authorization-1',
        last_sync_at: null,
        sync_config: { orders: true },
      },
    ]);

    expect(selected.map((row) => row.id)).toEqual(['express-enabled']);
    expect(selected[0]?.orderSyncScope).toBe('shared');
  });

  it('does not change the shared-scope owner when the database order changes', () => {
    const rows = [
      {
        id: 'retail',
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        country_code: 'NG',
        marketplace_key: 'NG-RETAIL',
        jumia_authorization_id: 'authorization-1',
        last_sync_at: null,
        sync_config: { orders: true },
      },
      {
        id: 'express',
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        country_code: 'NG',
        marketplace_key: 'NG-EXPRESS',
        jumia_authorization_id: 'authorization-1',
        last_sync_at: null,
        sync_config: { orders: true },
      },
    ];

    const selected = selectJumiaOrderSyncIntegrations([...rows].reverse());

    expect(selected.map((row) => row.id)).toEqual(['express']);
    expect(selected[0]?.orderSyncScope).toBe('shared');
  });

  it('keeps integrations backed by distinct self-authorization grants separate', () => {
    const selected = selectJumiaOrderSyncIntegrations([
      {
        id: 'grant-a',
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        country_code: 'NG',
        marketplace_key: 'NG-RETAIL',
        jumia_authorization_id: 'authorization-a',
        last_sync_at: null,
        sync_config: { orders: true },
      },
      {
        id: 'grant-b',
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        country_code: 'NG',
        marketplace_key: 'NG-RETAIL',
        jumia_authorization_id: 'authorization-b',
        last_sync_at: null,
        sync_config: { orders: true },
      },
    ]);

    expect(selected.map((row) => row.id)).toEqual(['grant-a', 'grant-b']);
  });
});
