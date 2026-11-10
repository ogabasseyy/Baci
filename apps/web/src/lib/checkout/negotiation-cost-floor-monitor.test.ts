import { beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({ logger: { warn } }));

import type { SupabaseClient } from '@supabase/supabase-js';
import { monitorNegotiationCostFloor } from './negotiation-cost-floor-monitor';

function clientReturning(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    overrideTypes: vi.fn().mockResolvedValue(result),
  };
  const from = vi.fn().mockReturnValue(query);
  return { client: { from } as unknown as SupabaseClient, from };
}

const line = (clientUnitPrice: number) => ({
  productId: 'p1',
  catalogUnitPrice: 100,
  clientUnitPrice,
  negotiable: true,
});

describe('monitorNegotiationCostFloor', () => {
  beforeEach(() => warn.mockReset());

  it('logs when a negotiated price is under cost * 1.1, without cost values', async () => {
    const { client } = clientReturning({
      data: [{ id: 'p1', cost_price: 95 }],
      error: null,
    });
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: [line(98)],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const payload = warn.mock.calls[0][0];
    expect(payload).toMatchObject({
      productId: 'p1',
      belowCostFloor: true,
      belowCost: false,
    });
    expect(JSON.stringify(payload)).not.toContain('95');
  });

  it('flags belowCost when the price is under cost itself', async () => {
    const { client } = clientReturning({
      data: [{ id: 'p1', cost_price: 99 }],
      error: null,
    });
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: [line(98)],
    });
    expect(warn.mock.calls[0][0]).toMatchObject({ belowCost: true });
  });

  it('stays silent when the price clears the cost floor', async () => {
    const { client } = clientReturning({
      data: [{ id: 'p1', cost_price: 60 }],
      error: null,
    });
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: [line(98)],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips the lookup for non-discounted or non-negotiable lines', async () => {
    const { client, from } = clientReturning({ data: [], error: null });
    await monitorNegotiationCostFloor({
      supabase: client,
      merchantId: 'm1',
      lines: [line(100), { ...line(90), negotiable: false }],
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('never throws when the cost lookup errors or the column is unreadable', async () => {
    const { client } = clientReturning({
      data: null,
      error: { message: 'permission denied for column cost_price' },
    });
    await expect(
      monitorNegotiationCostFloor({
        supabase: client,
        merchantId: 'm1',
        lines: [line(98)],
      })
    ).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
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
