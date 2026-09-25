import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import type { JumiaVariantPriceMapping } from './apply-jumia-variant-price-updates';
import { persistSubmittedJumiaPriceUpdate } from './persist-submitted-jumia-price-update';

const mockUpdateIn = vi.fn();
const mockUpdateEq = vi.fn();
const mockUpdateOr = vi.fn();
const mockRpc = vi.fn();

function stubSupabase(updateResult: { data: unknown; error: unknown }) {
  return {
    from: () => ({
      update: (payload: unknown) => ({
        in: (column: string, ids: unknown) => {
          mockUpdateIn(payload, column, ids);
          return {
            eq: (...eqArgs: unknown[]) => {
              mockUpdateEq(...eqArgs);
              return {
                or: (filter: string) => {
                  mockUpdateOr(filter);
                  return { select: () => updateResult };
                },
              };
            },
          };
        },
      }),
    }),
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

  it('scopes the sale write to the submitted SKU subset', async () => {
    const result = await persistSubmittedJumiaPriceUpdate({
      supabase: stubSupabase({ data: [{ id: 'map-1' }], error: null }) as never,
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
    expect(mockUpdateIn).toHaveBeenCalledTimes(1);
    expect(mockUpdateIn).toHaveBeenCalledWith(
      {
        updated_at: UPDATED_AT,
        jumia_sale_price: 800,
        jumia_sale_start: '2026-09-01T00:00:00Z',
        jumia_sale_end: '2026-09-30T00:00:00Z',
        update_token: UPDATE_TOKEN,
      },
      'id',
      ['map-1']
    );
    // The scalar write claims the row first, so the RPC must carry the
    // post-claim token rather than the stale load-time baseline.
    expect(mockRpc).toHaveBeenCalledWith('apply_jumia_variant_price_updates', {
      p_merchant_id: MERCHANT_ID,
      p_updates: [{ id: 'map-1', price: 900, expected_token: UPDATE_TOKEN }],
      p_update_token: UPDATE_TOKEN,
    });
    // Write-time claim: only rows still carrying a load-time baseline
    // may be overwritten, and the write restamps them with this
    // request's token.
    expect(mockUpdateOr).toHaveBeenCalledWith('update_token.eq.token-0');
  });

  it('persists nothing when the feed submitted no SKUs', async () => {
    const result = await persistSubmittedJumiaPriceUpdate({
      supabase: stubSupabase({ data: [], error: null }) as never,
      merchantId: MERCHANT_ID,
      mappings: [mapping()],
      overrides: { jumia_price: 900, jumia_sale_price: 800 },
      submittedSkus: [],
      updatedAt: UPDATED_AT,
      updateToken: UPDATE_TOKEN,
    });

    expect(result).toEqual({ ok: true });
    expect(mockUpdateIn).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('skips price writes for status-only overrides', async () => {
    const result = await persistSubmittedJumiaPriceUpdate({
      supabase: stubSupabase({ data: [], error: null }) as never,
      merchantId: MERCHANT_ID,
      mappings: [mapping()],
      overrides: {},
      submittedSkus: [],
      updatedAt: UPDATED_AT,
      updateToken: UPDATE_TOKEN,
    });

    expect(result).toEqual({ ok: true });
    expect(mockUpdateIn).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('reports the accepted feed when the sale write fails', async () => {
    const result = await persistSubmittedJumiaPriceUpdate({
      supabase: stubSupabase({
        data: null,
        error: { message: 'db down' },
      }) as never,
      merchantId: MERCHANT_ID,
      mappings: [mapping()],
      overrides: { jumia_sale_price: 800 },
      submittedSkus: ['SKU-1'],
      updatedAt: UPDATED_AT,
      updateToken: UPDATE_TOKEN,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toMatch(
      /accepted the price feed.*Refresh before retrying/
    );
  });

  it('reports the accepted feed when the variant price RPC fails', async () => {
    mockRpc.mockResolvedValueOnce({ error: { message: 'rpc down' } });

    const result = await persistSubmittedJumiaPriceUpdate({
      supabase: stubSupabase({ data: [], error: null }) as never,
      merchantId: MERCHANT_ID,
      mappings: [mapping()],
      overrides: { jumia_prices: { 'SKU-1': 900 } },
      submittedSkus: ['SKU-1'],
      updatedAt: UPDATED_AT,
      updateToken: UPDATE_TOKEN,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toMatch(
      /accepted the price feed.*variant prices.*Refresh before retrying/
    );
  });

  it('reports a reconciliation case when a concurrent save superseded the write', async () => {
    const result = await persistSubmittedJumiaPriceUpdate({
      supabase: stubSupabase({ data: [], error: null }) as never,
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
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
