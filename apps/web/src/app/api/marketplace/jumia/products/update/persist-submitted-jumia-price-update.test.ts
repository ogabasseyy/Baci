import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import type { JumiaVariantPriceMapping } from './persist-submitted-jumia-price-update';
import { persistSubmittedJumiaPriceUpdate } from './persist-submitted-jumia-price-update';

const mockRpc = vi.fn();

function stubSupabase() {
  return {
    rpc: (...args: unknown[]) => mockRpc(...args),
  };
}

function mapping(overrides: Partial<JumiaVariantPriceMapping> = {}) {
  return {
    id: 'map-1',
    jumia_sku: 'SKU-1',
    jumia_price: 1000,
    update_token: 'token-0',
    ...overrides,
  };
}

const MERCHANT_ID = 'merchant-1';
const UPDATE_TOKEN = 'token-1';
const UPDATED_AT = '2026-09-25T00:00:00.000Z';

describe('persistSubmittedJumiaPriceUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ error: null });
  });

  it('sends scalar and per-SKU writes in one guarded RPC call', async () => {
    const result = await persistSubmittedJumiaPriceUpdate({
      supabase: stubSupabase() as never,
      merchantId: MERCHANT_ID,
      mappings: [
        mapping(),
        mapping({ id: 'map-2', jumia_sku: 'SKU-2', jumia_price: 2000 }),
      ],
      overrides: {
        jumia_prices: { 'SKU-1': 900 },
        jumia_sale_price: 800,
        jumia_sale_start: '2026-09-01T00:00:00Z',
        jumia_sale_end: '2026-09-30T00:00:00Z',
      },
      submittedSkus: ['SKU-1'],
      updatedAt: UPDATED_AT,
      updateToken: UPDATE_TOKEN,
    });

    expect(result).toEqual({ ok: true });
    // One transactional call: the sale write is scoped to the submitted
    // SKU subset, and both writes carry load-time baselines (the RPC
    // rebases scalar-claimed rows to the claim token itself).
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      'apply_jumia_submitted_price_updates',
      {
        p_merchant_id: MERCHANT_ID,
        p_scalar: {
          values: {
            jumia_sale_price: 800,
            jumia_sale_start: '2026-09-01T00:00:00Z',
            jumia_sale_end: '2026-09-30T00:00:00Z',
            updated_at: UPDATED_AT,
          },
          targets: [{ id: 'map-1', expected_token: 'token-0' }],
        },
        p_updates: [{ id: 'map-1', price: 900, expected_token: 'token-0' }],
        p_update_token: UPDATE_TOKEN,
      }
    );
  });

  it('persists nothing when the feed submitted no SKUs', async () => {
    const result = await persistSubmittedJumiaPriceUpdate({
      supabase: stubSupabase() as never,
      merchantId: MERCHANT_ID,
      mappings: [mapping()],
      overrides: { jumia_price: 900, jumia_sale_price: 800 },
      submittedSkus: [],
      updatedAt: UPDATED_AT,
      updateToken: UPDATE_TOKEN,
    });

    expect(result).toEqual({ ok: true });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('skips price writes for status-only overrides', async () => {
    const result = await persistSubmittedJumiaPriceUpdate({
      supabase: stubSupabase() as never,
      merchantId: MERCHANT_ID,
      mappings: [mapping()],
      overrides: {},
      submittedSkus: [],
      updatedAt: UPDATED_AT,
      updateToken: UPDATE_TOKEN,
    });

    expect(result).toEqual({ ok: true });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('reports the accepted feed when the submitted-price RPC fails', async () => {
    mockRpc.mockResolvedValueOnce({ error: { message: 'db down' } });

    const result = await persistSubmittedJumiaPriceUpdate({
      supabase: stubSupabase() as never,
      merchantId: MERCHANT_ID,
      mappings: [mapping()],
      overrides: { jumia_sale_price: 800 },
      submittedSkus: ['SKU-1'],
      updatedAt: UPDATED_AT,
      updateToken: UPDATE_TOKEN,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toMatch(
      /accepted the price feed.*local details.*Refresh before retrying/
    );
  });

  it('reports a reconciliation case when a concurrent save superseded the write', async () => {
    mockRpc.mockResolvedValueOnce({
      error: {
        message: 'Jumia price update superseded by a newer save',
        code: '40001',
      },
    });

    const result = await persistSubmittedJumiaPriceUpdate({
      supabase: stubSupabase() as never,
      merchantId: MERCHANT_ID,
      mappings: [mapping()],
      overrides: { jumia_sale_price: 800 },
      submittedSkus: ['SKU-1'],
      updatedAt: UPDATED_AT,
      updateToken: UPDATE_TOKEN,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toMatch(
      /Another save updated this product.*Refresh before retrying/
    );
  });
});
