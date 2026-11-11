import { beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({ logger: { warn } }));

import type { SupabaseClient } from '@supabase/supabase-js';
import { monitorNegotiationCostFloor } from './negotiation-cost-floor-monitor';

type Result = { data: unknown; error: unknown };

function clientReturning(tables: Record<string, Result>) {
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      overrideTypes: vi
        .fn()
        .mockResolvedValue(tables[table] ?? { data: [], error: null }),
    };
    return query;
  });
  return { client: { from } as unknown as SupabaseClient, from };
}

const line = (clientUnitPrice: number, variantId: string | null = null) => ({
  productId: 'p1',
  variantId,
  catalogUnitPrice: 100,
  clientUnitPrice,
  negotiable: true,
});

describe('monitorNegotiationCostFloor', () => {
  beforeEach(() => warn.mockReset());

  it('logs one aggregated entry when a price is under cost * 1.1, without cost values', async () => {
    const { client } = clientReturning({
      products: { data: [{ id: 'p1', cost_price: 95 }], error: null },
    });
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: [line(98), { ...line(97), productId: 'p1' }],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const payload = warn.mock.calls[0][0];
    expect(payload.breaches).toHaveLength(2);
    expect(payload.breaches[0]).toMatchObject({
      productId: 'p1',
      negotiatedUnitPrice: 98,
      belowCost: false,
    });
    expect(JSON.stringify(payload)).not.toContain('"cost');
  });

  it('flags belowCost when the price is under cost itself', async () => {
    const { client } = clientReturning({
      products: { data: [{ id: 'p1', cost_price: 99 }], error: null },
    });
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: [line(98)],
    });
    expect(warn.mock.calls[0][0].breaches[0]).toMatchObject({
      belowCost: true,
    });
  });

  it('uses the variant cost over the parent cost (regression: variant at cost 99, parent 60)', async () => {
    const { client } = clientReturning({
      products: { data: [{ id: 'p1', cost_price: 60 }], error: null },
      product_variants: {
        data: [{ id: 'v1', product_id: 'p1', cost_price: 99 }],
        error: null,
      },
    });
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: [line(98, 'v1')],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0].breaches[0]).toMatchObject({
      variantId: 'v1',
      belowCost: true,
    });
  });

  it('falls back to the parent cost when the variant has none', async () => {
    const { client } = clientReturning({
      products: { data: [{ id: 'p1', cost_price: 95 }], error: null },
      product_variants: {
        data: [{ id: 'v1', product_id: 'p1', cost_price: null }],
        error: null,
      },
    });
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: [line(98, 'v1')],
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not flag a price exactly on the 10% margin (regression: 100 * 1.1 float error)', async () => {
    const { client } = clientReturning({
      products: { data: [{ id: 'p1', cost_price: 100 }], error: null },
    });
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: [{ ...line(110), catalogUnitPrice: 112 }],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports unreadable variant cost instead of falling back to the parent (regression: RLS-empty variant read)', async () => {
    const { client } = clientReturning({
      products: { data: [{ id: 'p1', cost_price: 60 }], error: null },
      product_variants: { data: [], error: null },
    });
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: [line(98, 'v1')],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({
      message: 'Negotiation cost-floor monitor could not read variant cost',
      unreadableVariantLines: 1,
    });
  });

  it('logs the variant lookup error code in the unreadable-variant warning', async () => {
    const { client } = clientReturning({
      products: { data: [{ id: 'p1', cost_price: 60 }], error: null },
      product_variants: { data: null, error: { code: '42501' } },
    });
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: [line(98, 'v1')],
    });
    expect(warn.mock.calls[0][0]).toMatchObject({
      unreadableVariantLines: 1,
      variantLookupErrorCode: '42501',
    });
  });

  it('skips a variant that belongs to another product', async () => {
    const { client } = clientReturning({
      products: { data: [{ id: 'p1', cost_price: 60 }], error: null },
      product_variants: {
        data: [{ id: 'v1', product_id: 'other', cost_price: 99 }],
        error: null,
      },
    });
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: [line(98, 'v1')],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({ unreadableVariantLines: 1 });
  });

  it('includes the line quantity in the breach entry', async () => {
    const { client } = clientReturning({
      products: { data: [{ id: 'p1', cost_price: 99 }], error: null },
    });
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: [{ ...line(98), quantity: 10 }],
    });
    expect(warn.mock.calls[0][0].breaches[0]).toMatchObject({ quantity: 10 });
  });

  it('reports a coverage gap for lines without a readable product cost (regression: silent skip)', async () => {
    const { client } = clientReturning({
      products: { data: [], error: null },
    });
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: [line(98)],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({
      message: 'Negotiation cost-floor monitor coverage gap',
      unreadableProductLines: 1,
      truncatedLines: 0,
    });
  });

  it('reports lines dropped by the per-order cap', async () => {
    const { client } = clientReturning({
      products: { data: [{ id: 'p1', cost_price: 60 }], error: null },
    });
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: Array.from({ length: 22 }, () => line(98)),
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({ truncatedLines: 2 });
  });

  it('stays silent when the price clears the cost floor', async () => {
    const { client } = clientReturning({
      products: { data: [{ id: 'p1', cost_price: 60 }], error: null },
    });
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: [line(98)],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips the lookup for non-discounted or non-negotiable lines', async () => {
    const { client, from } = clientReturning({});
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: [line(100), { ...line(90), negotiable: false }],
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('never throws when the cost lookup errors or the column is unreadable', async () => {
    const { client } = clientReturning({
      products: {
        data: null,
        error: { message: 'permission denied for column cost_price' },
      },
    });
    await expect(
      monitorNegotiationCostFloor({
        supabase: client,
        merchantId: 'm1',
        lines: [line(98)],
      })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({
      message: 'Negotiation cost-floor monitor could not read product cost',
    });
  });

  it('never throws when the client itself throws', async () => {
    const client = {
      from: () => {
        throw new Error('boom');
      },
    } as unknown as SupabaseClient;
    await expect(
      monitorNegotiationCostFloor({
        supabase: client,
        merchantId: 'm1',
        lines: [line(98)],
      })
    ).resolves.toBeUndefined();
  });
});
