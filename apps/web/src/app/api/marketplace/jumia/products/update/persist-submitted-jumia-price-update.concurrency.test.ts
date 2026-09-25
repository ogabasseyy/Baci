import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import { persistSubmittedJumiaPriceUpdate } from './persist-submitted-jumia-price-update';

type MappingRow = {
  update_token: string | null;
  jumia_price: number;
  jumia_sale_price?: number | null;
};

type RpcUpdate = { id: string; price: number; expected_token: string | null };

// Faithful stand-in: applies predicates and mutations like Postgres, so
// these tests prove interleavings rather than merely asserting call args.
function createStatefulSupabase(initialRows: Record<string, MappingRow>) {
  const rows = new Map(Object.entries(initialRows));
  let updateCalls = 0;

  function matchesOrFilter(
    row: MappingRow,
    filter: string,
    merchantId: string
  ): boolean {
    if (merchantId !== 'merchant-1') return false;
    return filter.split(',').some((condition) => {
      if (condition === 'update_token.is.null')
        return row.update_token === null;
      const prefix = 'update_token.eq.';
      if (condition.startsWith(prefix)) {
        return row.update_token === condition.slice(prefix.length);
      }
      return false;
    });
  }

  const supabase = {
    from: () => ({
      update: (payload: Record<string, unknown>) => ({
        in: (_column: string, ids: string[]) => ({
          eq: (_field: string, merchantId: string) => ({
            or: (filter: string) => ({
              select: () => {
                updateCalls += 1;
                const matched = ids.filter((id) => {
                  const row = rows.get(id);
                  return (
                    row && matchesOrFilter(row, filter, merchantId as string)
                  );
                });
                for (const id of matched) {
                  const current = rows.get(id);
                  if (current) rows.set(id, { ...current, ...payload });
                }
                return {
                  data: matched.map((id) => ({ id })),
                  error: null,
                };
              },
            }),
          }),
        }),
      }),
    }),
    rpc: (
      _name: string,
      params: { p_updates: RpcUpdate[]; p_update_token: string }
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

  return {
    supabase: supabase as never,
    rows,
    updateCallCount: () => updateCalls,
  };
}

function loadedMapping(id: string, sku: string, updateToken: string | null) {
  return { id, jumia_sku: sku, jumia_price: 1000, update_token: updateToken };
}

const MERCHANT_ID = 'merchant-1';
const UPDATED_AT = '2026-09-25T00:00:00.000Z';

describe('persistSubmittedJumiaPriceUpdate concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies combined sale and per-SKU prices against the post-claim token', async () => {
    const { supabase, rows } = createStatefulSupabase({
      'map-1': { update_token: 'token-0', jumia_price: 1000 },
    });

    const result = await persistSubmittedJumiaPriceUpdate({
      supabase,
      merchantId: MERCHANT_ID,
      mappings: [loadedMapping('map-1', 'SKU-1', 'token-0')],
      overrides: {
        jumia_prices: { 'SKU-1': 900 },
        jumia_sale_price: 800,
      },
      submittedSkus: ['SKU-1'],
      updatedAt: UPDATED_AT,
      updateToken: 'token-1',
    });

    expect(result).toEqual({ ok: true });
    expect(rows.get('map-1')).toEqual(
      expect.objectContaining({
        update_token: 'token-1',
        jumia_price: 900,
        jumia_sale_price: 800,
      })
    );
  });

  it('claims split baselines in one statement and reports a partial shortfall', async () => {
    const { supabase, rows, updateCallCount } = createStatefulSupabase({
      'map-1': { update_token: 'token-a', jumia_price: 1000 },
      'map-2': { update_token: 'token-stale', jumia_price: 2000 },
    });

    // map-2 was claimed by a newer save after this request loaded it.
    const result = await persistSubmittedJumiaPriceUpdate({
      supabase,
      merchantId: MERCHANT_ID,
      mappings: [
        loadedMapping('map-1', 'SKU-1', 'token-a'),
        { ...loadedMapping('map-2', 'SKU-2', 'token-b'), jumia_price: 2000 },
      ],
      overrides: { jumia_sale_price: 800 },
      submittedSkus: ['SKU-1', 'SKU-2'],
      updatedAt: UPDATED_AT,
      updateToken: 'token-1',
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toMatch(/Another save updated/);
    // A single guarded statement: the matching row is claimed while the
    // concurrently claimed row is left untouched.
    expect(updateCallCount()).toBe(1);
    expect(rows.get('map-1')).toEqual(
      expect.objectContaining({
        update_token: 'token-1',
        jumia_price: 1000,
        jumia_sale_price: 800,
      })
    );
    expect(rows.get('map-2')).toEqual({
      update_token: 'token-stale',
      jumia_price: 2000,
    });
  });

  it('rejects a stale per-SKU save that resolves after a newer save', async () => {
    const { supabase, rows } = createStatefulSupabase({
      'map-1': { update_token: 'token-0', jumia_price: 1000 },
    });
    const mappings = [loadedMapping('map-1', 'SKU-1', 'token-0')];

    const newer = await persistSubmittedJumiaPriceUpdate({
      supabase,
      merchantId: MERCHANT_ID,
      mappings,
      overrides: { jumia_prices: { 'SKU-1': 900 } },
      submittedSkus: ['SKU-1'],
      updatedAt: UPDATED_AT,
      updateToken: 'token-newer',
    });
    expect(newer).toEqual({ ok: true });

    const older = await persistSubmittedJumiaPriceUpdate({
      supabase,
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
    const { supabase, rows, updateCallCount } = createStatefulSupabase({
      'map-1': { update_token: 'token-0', jumia_price: 1000 },
    });
    const mappings = [loadedMapping('map-1', 'SKU-1', 'token-0')];

    const failed = await persistSubmittedJumiaPriceUpdate({
      supabase,
      merchantId: MERCHANT_ID,
      mappings,
      overrides: { jumia_prices: { 'SKU-1': 950 }, jumia_sale_price: 700 },
      submittedSkus: [],
      updatedAt: UPDATED_AT,
      updateToken: 'token-failed',
    });
    expect(failed).toEqual({ ok: true });
    expect(updateCallCount()).toBe(0);

    const accepted = await persistSubmittedJumiaPriceUpdate({
      supabase,
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

  it('claims unstamped rows through the null baseline', async () => {
    const { supabase, rows } = createStatefulSupabase({
      'map-1': { update_token: null, jumia_price: 1000 },
    });

    const result = await persistSubmittedJumiaPriceUpdate({
      supabase,
      merchantId: MERCHANT_ID,
      mappings: [loadedMapping('map-1', 'SKU-1', null)],
      overrides: { jumia_sale_price: 800 },
      submittedSkus: ['SKU-1'],
      updatedAt: UPDATED_AT,
      updateToken: 'token-1',
    });

    expect(result).toEqual({ ok: true });
    expect(rows.get('map-1')).toEqual(
      expect.objectContaining({
        update_token: 'token-1',
        jumia_price: 1000,
        jumia_sale_price: 800,
      })
    );
  });
});
