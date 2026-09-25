import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateRouteTestHarness as harness } from './route-test-harness';

const { INTEGRATION_ID, MERCHANT_ID, PRODUCT_ID } = harness.ids;

describe('POST /api/marketplace/jumia/products/update', () => {
  beforeEach(() => {
    harness.reset();
  });

  it('returns 401 when user is not authenticated', async () => {
    harness.mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await harness.post(
      harness.makeRequest({
        integrationId: INTEGRATION_ID,
        overrides: { is_active: false },
        productId: PRODUCT_ID,
      })
    );

    expect(response.status).toBe(401);
  });

  it('returns 402 before reading mappings or creating a Jumia client when marketplace sync is locked', async () => {
    harness.mocks.requireMerchantFeatureAccess.mockResolvedValueOnce(
      Response.json(
        {
          code: 'requires_upgrade',
          error: 'Marketplace sync requires Baci Pro',
        },
        { status: 402 }
      )
    );

    const response = await harness.post(
      harness.makeRequest({
        integrationId: INTEGRATION_ID,
        overrides: { is_active: false },
        productId: PRODUCT_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.code).toBe('requires_upgrade');
    expect(harness.mocks.requireMerchantFeatureAccess).toHaveBeenCalledWith(
      harness.supabase,
      MERCHANT_ID,
      'marketplace_sync'
    );
    expect(harness.supabase.from).not.toHaveBeenCalledWith(
      'jumia_product_mappings'
    );
    expect(harness.mocks.forIntegration).not.toHaveBeenCalled();
    expect(harness.mocks.mappingUpdate).not.toHaveBeenCalled();
    expect(harness.mocks.pushStatusUpdates).not.toHaveBeenCalled();
    expect(harness.mocks.pushPriceUpdates).not.toHaveBeenCalled();
  });

  it('returns before updating mappings when marketplace currency loading fails for price updates', async () => {
    vi.mocked(harness.loadCurrency).mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: 'Failed to load Jumia integration currency',
    });

    const response = await harness.post(
      harness.makeRequest({
        integrationId: INTEGRATION_ID,
        overrides: { jumia_price: 1500 },
        productId: PRODUCT_ID,
      })
    );

    expect(response.status).toBe(500);
    expect(harness.mocks.mappingUpdate).not.toHaveBeenCalled();
    expect(harness.mocks.pushPriceUpdates).not.toHaveBeenCalled();
  });

  it('does not persist overrides when a mapped variant is not ready on Jumia', async () => {
    harness.mocks.mappingsOrder.mockResolvedValueOnce({
      data: [
        {
          id: 'map-pending',
          product_id: PRODUCT_ID,
          variant_id: 'variant-1',
          jumia_product_id: null,
          jumia_sku: 'SKU-1',
          jumia_price: 1000,
          jumia_sale_price: null,
          jumia_sale_start: null,
          jumia_sale_end: null,
        },
      ],
      error: null,
    });

    const response = await harness.post(
      harness.makeRequest({
        integrationId: INTEGRATION_ID,
        overrides: { is_active: false, jumia_price: 900 },
        productId: PRODUCT_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      success: false,
      feedIds: [],
      errors: [
        'Status update skipped: product has not been assigned a Jumia product ID yet (feed may still be processing)',
        'Price update skipped: product has not been assigned a Jumia product ID yet (feed may still be processing)',
      ],
    });
    expect(harness.mocks.mappingUpdate).not.toHaveBeenCalled();
    expect(harness.mocks.pushStatusUpdates).not.toHaveBeenCalled();
    expect(harness.mocks.pushPriceUpdates).not.toHaveBeenCalled();
  });

  it('verifies OAuth scope before mutating mappings', async () => {
    harness.mocks.forIntegration.mockResolvedValue({
      shopId: 'shop-1',
      marketplaceKey: 'oauth',
    });

    const response = await harness.post(
      harness.makeRequest({
        integrationId: INTEGRATION_ID,
        overrides: { is_active: false },
        productId: PRODUCT_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      success: false,
      feedIds: [],
      errors: ['Unable to verify the Jumia shop marketplace scope. Try again.'],
    });
    expect(harness.mocks.mappingUpdate).not.toHaveBeenCalled();
    expect(harness.mocks.pushStatusUpdates).not.toHaveBeenCalled();
    expect(harness.mocks.pushPriceUpdates).not.toHaveBeenCalled();
  });

  it('persists variant prices after the price feed is accepted', async () => {
    vi.mocked(harness.loadCurrency).mockResolvedValue({
      ok: true,
      currency: 'NGN',
    });
    harness.mocks.pushPriceUpdates.mockResolvedValue({
      submittedSkus: ['SKU-1'],
    });

    const response = await harness.post(
      harness.makeRequest({
        integrationId: INTEGRATION_ID,
        overrides: { jumia_prices: { 'SKU-1': 900 } },
        productId: PRODUCT_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(harness.mocks.pushPriceUpdates).toHaveBeenCalled();
    expect(harness.mocks.rpc).toHaveBeenCalledWith(
      'apply_jumia_variant_price_updates',
      {
        p_merchant_id: MERCHANT_ID,
        p_updates: [{ id: 'map-1', price: 900, expected_token: 'token-0' }],
        p_update_token: expect.any(String),
      }
    );
  });

  it('keeps accepted feed ids when post-push persistence fails', async () => {
    vi.mocked(harness.loadCurrency).mockResolvedValue({
      ok: true,
      currency: 'NGN',
    });
    harness.mocks.pushPriceUpdates.mockImplementationOnce(
      async (...args: unknown[]) => {
        (args[4] as string[]).push('feed-1');
        return { submittedSkus: ['SKU-1'] };
      }
    );
    harness.mocks.mappingUpdate
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'db down' } });

    const response = await harness.post(
      harness.makeRequest({
        integrationId: INTEGRATION_ID,
        overrides: { jumia_price: 900 },
        productId: PRODUCT_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.feedIds).toEqual(['feed-1']);
    expect(body.errors).toEqual([
      expect.stringMatching(/accepted the price feed/),
    ]);
  });

  it('preserves earlier provider errors when post-push persistence fails', async () => {
    vi.mocked(harness.loadCurrency).mockResolvedValue({
      ok: true,
      currency: 'NGN',
    });
    harness.mocks.pushStatusUpdates.mockImplementationOnce(
      async (...args: unknown[]) => {
        (args[4] as string[]).push('Status update failed: provider rejected');
      }
    );
    harness.mocks.pushPriceUpdates.mockImplementationOnce(
      async (...args: unknown[]) => {
        (args[4] as string[]).push('feed-1');
        return { submittedSkus: ['SKU-1'] };
      }
    );
    harness.mocks.mappingUpdate
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'db down' } });

    const response = await harness.post(
      harness.makeRequest({
        integrationId: INTEGRATION_ID,
        overrides: { is_active: false, jumia_price: 900 },
        productId: PRODUCT_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.feedIds).toEqual(['feed-1']);
    expect(body.errors).toEqual([
      'Status update failed: provider rejected',
      expect.stringMatching(/accepted the price feed/),
    ]);
  });
});
