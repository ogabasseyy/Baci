import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import type { JumiaVariantPriceMapping } from './apply-jumia-variant-price-updates';
import { persistSubmittedJumiaPriceUpdate } from './persist-submitted-jumia-price-update';

const mockUpdateIn = vi.fn();
const mockUpdateEq = vi.fn();
const mockUpdateIs = vi.fn();
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
                eq: (...guardArgs: unknown[]) => {
                  mockUpdateEq(...guardArgs);
                  return { select: () => updateResult };
                },
                is: (...guardArgs: unknown[]) => {
                  mockUpdateIs(...guardArgs);
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
    expect(mockRpc).toHaveBeenCalledWith('apply_jumia_variant_price_updates', {
      p_merchant_id: MERCHANT_ID,
      p_updates: [{ id: 'map-1', price: 900, expected_token: 'token-0' }],
      p_update_token: UPDATE_TOKEN,
    });
    // Write-time claim: only rows still carrying the load-time baseline
    // may be overwritten, and the write restamps them with this
    // request's token.
    expect(mockUpdateEq).toHaveBeenCalledWith('update_token', 'token-0');
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

  it('claims unstamped rows through the null-baseline partition', async () => {
    const result = await persistSubmittedJumiaPriceUpdate({
      supabase: stubSupabase({ data: [{ id: 'map-1' }], error: null }) as never,
      merchantId: MERCHANT_ID,
      mappings: [mapping({ update_token: null })],
      overrides: { jumia_sale_price: 800 },
      submittedSkus: ['SKU-1'],
      updatedAt: UPDATED_AT,
      updateToken: UPDATE_TOKEN,
    });

    expect(result).toEqual({ ok: true });
    expect(mockUpdateIs).toHaveBeenCalledWith('update_token', null);
  });

  it('rejects a stale per-SKU save that resolves after a newer save', async () => {
    // Both saves load the same baseline token; the newer save claims the
    // row first, so the older save must lose the write-time guard.
    const rows = new Map([
      ['map-1', { update_token: 'token-0', jumia_price: 1000 }],
    ]);
    // Stateful stand-in that enforces the same contracts as Postgres: the
    // RPC rejects baselines that no longer match and claims on success.
    const stateful = {
      from: () => ({
        update: () => {
          throw new Error('per-SKU-only saves must not issue scalar writes');
        },
      }),
      rpc: (
        _name: string,
        params: {
          p_updates: Array<{
            id: string;
            price: number;
            expected_token: string | null;
          }>;
          p_update_token: string;
        }
      ) => {
        const stale = params.p_updates.some((update) => {
          const current = rows.get(update.id)?.update_token ?? null;
          return current !== update.expected_token;
        });
        if (stale) {
          return {
            error: {
              message: 'Jumia price update superseded by a newer save',
              code: '40001',
            },
          };
        }
        for (const update of params.p_updates) {
          const current = rows.get(update.id);
          if (current) {
            rows.set(update.id, {
              ...current,
              jumia_price: update.price,
              update_token: params.p_update_token,
            });
          }
        }
        return { error: null };
      },
    };
    const mappings = [
      {
        id: 'map-1',
        jumia_sku: 'SKU-1',
        jumia_price: 1000,
        update_token: 'token-0',
      },
    ];

    const newer = await persistSubmittedJumiaPriceUpdate({
      supabase: stateful as never,
      merchantId: MERCHANT_ID,
      mappings,
      overrides: { jumia_prices: { 'SKU-1': 900 } },
      submittedSkus: ['SKU-1'],
      updatedAt: UPDATED_AT,
      updateToken: 'token-newer',
    });
    expect(newer).toEqual({ ok: true });

    const older = await persistSubmittedJumiaPriceUpdate({
      supabase: stateful as never,
      merchantId: MERCHANT_ID,
      mappings,
      overrides: { jumia_prices: { 'SKU-1': 700 } },
      submittedSkus: ['SKU-1'],
      updatedAt: UPDATED_AT,
      updateToken: 'token-older',
    });
    expect(older.ok).toBe(false);
    expect(older.ok ? '' : older.error).toMatch(/Another save updated/);
    expect(rows.get('map-1')?.jumia_price).toBe(900);
  });

  it('lets an accepted save through after an overlapping save fails its feed', async () => {
    // Failed saves perform no writes at all, so they must not poison the
    // token an overlapping accepted save claims.
    const rows = new Map([
      ['map-1', { update_token: 'token-0', jumia_price: 1000 }],
    ]);
    let updateCalls = 0;
    const stateful = {
      from: () => ({
        update: () => {
          updateCalls += 1;
          throw new Error('failed saves must not write');
        },
      }),
      rpc: (
        _name: string,
        params: {
          p_updates: Array<{
            id: string;
            price: number;
            expected_token: string | null;
          }>;
          p_update_token: string;
        }
      ) => {
        const stale = params.p_updates.some((update) => {
          const current = rows.get(update.id)?.update_token ?? null;
          return current !== update.expected_token;
        });
        if (stale) {
          return {
            error: {
              message: 'Jumia price update superseded by a newer save',
              code: '40001',
            },
          };
        }
        for (const update of params.p_updates) {
          const current = rows.get(update.id);
          if (current) {
            rows.set(update.id, {
              ...current,
              jumia_price: update.price,
              update_token: params.p_update_token,
            });
          }
        }
        return { error: null };
      },
    };
    const mappings = [
      {
        id: 'map-1',
        jumia_sku: 'SKU-1',
        jumia_price: 1000,
        update_token: 'token-0',
      },
    ];

    const failed = await persistSubmittedJumiaPriceUpdate({
      supabase: stateful as never,
      merchantId: MERCHANT_ID,
      mappings,
      overrides: { jumia_prices: { 'SKU-1': 950 }, jumia_sale_price: 700 },
      submittedSkus: [],
      updatedAt: UPDATED_AT,
      updateToken: 'token-failed',
    });
    expect(failed).toEqual({ ok: true });
    expect(updateCalls).toBe(0);

    const accepted = await persistSubmittedJumiaPriceUpdate({
      supabase: stateful as never,
      merchantId: MERCHANT_ID,
      mappings,
      overrides: { jumia_prices: { 'SKU-1': 900 } },
      submittedSkus: ['SKU-1'],
      updatedAt: UPDATED_AT,
      updateToken: 'token-accepted',
    });
    expect(accepted).toEqual({ ok: true });
    expect(rows.get('map-1')).toEqual({
      update_token: 'token-accepted',
      jumia_price: 900,
    });
  });
});
