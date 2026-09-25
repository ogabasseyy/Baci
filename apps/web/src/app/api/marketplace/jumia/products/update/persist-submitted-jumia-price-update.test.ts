import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import type { JumiaVariantPriceMapping } from './apply-jumia-variant-price-updates';
import { persistSubmittedJumiaPriceUpdate } from './persist-submitted-jumia-price-update';

const mockUpdateIn = vi.fn();
const mockUpdateEq = vi.fn();
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
      },
      'id',
      ['map-1']
    );
    expect(mockRpc).toHaveBeenCalledWith('apply_jumia_variant_price_updates', {
      p_merchant_id: MERCHANT_ID,
      p_updates: [{ id: 'map-1', price: 900 }],
      p_expected_update_token: UPDATE_TOKEN,
    });
    // Optimistic guard: only rows still stamped with this request's
    // unique pre-push token may be overwritten.
    expect(mockUpdateEq).toHaveBeenCalledWith('update_token', UPDATE_TOKEN);
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

  it('rejects a stale per-SKU save that resolves after a newer save', async () => {
    // Both saves start within the same millisecond tick: only the unique
    // request tokens distinguish them.
    const sameTick = '2026-09-25T10:00:00.000Z';
    const rows = new Map([
      ['map-1', { update_token: 'token-older', jumia_price: 1000 }],
    ]);
    // Stateful stand-in that enforces the same contracts as Postgres: eq
    // predicates filter, the RPC rejects tokens that no longer match.
    const stateful = {
      from: () => ({
        update: (payload: Record<string, unknown>) => ({
          in: (_column: string, ids: string[]) => ({
            eq: (...first: [string, unknown]) => ({
              eq: (...second: [string, unknown]) => ({
                select: () => {
                  const matched = ids.filter((id) => {
                    const row = rows.get(id);
                    if (!row) return false;
                    return [first, second].every(
                      ([column, value]) =>
                        column === 'merchant_id' ||
                        (row as Record<string, unknown>)[column] === value
                    );
                  });
                  for (const id of matched) {
                    const current = rows.get(id);
                    if (current) rows.set(id, { ...current, ...payload });
                  }
                  return { data: matched.map((id) => ({ id })), error: null };
                },
              }),
            }),
          }),
        }),
      }),
      rpc: (
        _name: string,
        params: {
          p_updates: Array<{ id: string; price: number }>;
          p_expected_update_token: string;
        }
      ) => {
        const stale = params.p_updates.some(
          (update) =>
            rows.get(update.id)?.update_token !== params.p_expected_update_token
        );
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
            });
          }
        }
        return { error: null };
      },
    };
    const mappings = [{ id: 'map-1', jumia_sku: 'SKU-1', jumia_price: 1000 }];

    // The newer save lands first: its pre-push token replaces the older
    // one, then its per-SKU prices persist.
    const newerRow = rows.get('map-1');
    if (newerRow) newerRow.update_token = 'token-newer';
    const newer = await persistSubmittedJumiaPriceUpdate({
      supabase: stateful as never,
      merchantId: MERCHANT_ID,
      mappings,
      overrides: { jumia_prices: { 'SKU-1': 900 } },
      submittedSkus: ['SKU-1'],
      updatedAt: sameTick,
      updateToken: 'token-newer',
    });
    expect(newer).toEqual({ ok: true });

    // The older save resolves last: its RPC must be rejected and the
    // newer price must survive.
    const older = await persistSubmittedJumiaPriceUpdate({
      supabase: stateful as never,
      merchantId: MERCHANT_ID,
      mappings,
      overrides: { jumia_prices: { 'SKU-1': 700 } },
      submittedSkus: ['SKU-1'],
      updatedAt: sameTick,
      updateToken: 'token-older',
    });
    expect(older.ok).toBe(false);
    expect(older.ok ? '' : older.error).toMatch(/Another save updated/);
    expect(rows.get('map-1')?.jumia_price).toBe(900);
  });
});
