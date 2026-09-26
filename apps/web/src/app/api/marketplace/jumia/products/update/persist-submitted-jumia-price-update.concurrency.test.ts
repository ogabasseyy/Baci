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

type ScalarTarget = { id: string; expected_token: string | null };
type RpcUpdate = { id: string; price: number; expected_token: string | null };
type RpcParams = {
  p_merchant_id: string;
  p_scalar: { values: Record<string, unknown>; targets: ScalarTarget[] };
  p_updates: RpcUpdate[];
  p_update_token: string;
};

const SUPERSEDED = {
  message: 'Jumia price update superseded by a newer save',
  code: '40001',
};
const NOT_FOUND = { message: 'Jumia price update target not found' };

// Faithful stand-in for apply_jumia_submitted_price_updates: validates
// against a scratch copy and commits only when every guarded write
// matches, so these tests prove all-or-nothing behavior.
function createStatefulSupabase(initialRows: Record<string, MappingRow>) {
  const rows = new Map(Object.entries(initialRows));
  let rpcCalls = 0;

  const supabase = {
    rpc: (_name: string, params: RpcParams) => {
      rpcCalls += 1;
      if (params.p_merchant_id !== 'merchant-1') {
        return { error: { message: 'Not authorized', code: '42501' } };
      }
      const staged = new Map(
        [...rows.entries()].map(([id, row]) => [id, { ...row }])
      );
      for (const target of params.p_scalar.targets) {
        const row = staged.get(target.id);
        if (!row) return { error: NOT_FOUND };
        if ((row.update_token ?? null) !== target.expected_token) {
          return { error: SUPERSEDED };
        }
      }
      const claimedIds = new Set(
        params.p_scalar.targets.map((target) => target.id)
      );
      for (const target of params.p_scalar.targets) {
        const row = staged.get(target.id);
        if (!row) return { error: NOT_FOUND };
        const values = params.p_scalar.values;
        if (Object.hasOwn(values, 'jumia_price')) {
          row.jumia_price = values.jumia_price as number;
        }
        if (Object.hasOwn(values, 'jumia_sale_price')) {
          row.jumia_sale_price = values.jumia_sale_price as number | null;
        }
        row.update_token = params.p_update_token;
      }
      for (const update of params.p_updates) {
        const row = staged.get(update.id);
        if (!row) return { error: NOT_FOUND };
        const baseline = claimedIds.has(update.id)
          ? params.p_update_token
          : update.expected_token;
        if ((row.update_token ?? null) !== baseline) {
          return { error: SUPERSEDED };
        }
        row.jumia_price = update.price;
        row.update_token = params.p_update_token;
      }
      for (const [id, row] of staged) rows.set(id, row);
      return { error: null };
    },
  };

  return {
    supabase: supabase as never,
    rows,
    rpcCallCount: () => rpcCalls,
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

  it('rolls back every row when a split-baseline shortfall misses', async () => {
    const { supabase, rows, rpcCallCount } = createStatefulSupabase({
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
    // One transactional call: the shortfall rolls back the matching row
    // instead of leaving the product half-claimed.
    expect(rpcCallCount()).toBe(1);
    expect(rows.get('map-1')).toEqual({
      update_token: 'token-a',
      jumia_price: 1000,
    });
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

  it('leaves every row untouched when a price target is missing', async () => {
    const { supabase, rows } = createStatefulSupabase({
      'map-1': { update_token: 'token-0', jumia_price: 1000 },
    });

    const result = await persistSubmittedJumiaPriceUpdate({
      supabase,
      merchantId: MERCHANT_ID,
      mappings: [
        loadedMapping('map-1', 'SKU-1', 'token-0'),
        loadedMapping('map-2', 'SKU-2', 'token-0'),
      ],
      overrides: { jumia_prices: { 'SKU-1': 900, 'SKU-2': 1900 } },
      submittedSkus: ['SKU-1', 'SKU-2'],
      updatedAt: UPDATED_AT,
      updateToken: 'token-1',
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toMatch(/accepted the price feed/);
    expect(rows.get('map-1')).toEqual({
      update_token: 'token-0',
      jumia_price: 1000,
    });
    expect(rows.has('map-2')).toBe(false);
  });

  it('lets an accepted save through after an overlapping save fails its feed', async () => {
    const { supabase, rows, rpcCallCount } = createStatefulSupabase({
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
    expect(rpcCallCount()).toBe(0);

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
