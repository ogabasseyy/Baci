import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { hasCostFloorBreach } from './order-negotiation-cost-floor';

function client(floor: unknown, error: unknown = null) {
  const rpc = vi.fn(() => Promise.resolve({ data: floor, error }));
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

const line = (clientUnitPrice: number, negotiable = true) => ({
  productId: 'p1',
  catalogUnitPrice: 1000,
  clientUnitPrice,
  negotiable,
});
const run = (supabase: SupabaseClient, lines = [line(980)]) =>
  hasCostFloorBreach({
    supabase,
    merchantId: 'm1',
    lines,
    parentPrices: new Map([['p1', 1000]]),
  });

describe('hasCostFloorBreach', () => {
  it('flags a discount under cost * 1.1 when cost dominates the floor', async () => {
    const { supabase } = client(990); // cost 900 => floor 990
    await expect(run(supabase)).resolves.toBe(true);
  });

  it('flags every discount when cost * 1.1 exceeds the price (bugfix: sold below cost)', async () => {
    const { supabase } = client(1210); // cost 1100 > price 1000
    await expect(run(supabase, [line(990)])).resolves.toBe(true);
  });

  it('allows a discount that keeps the margin', async () => {
    const { supabase } = client(970); // floor is the 2% band, cost does not dominate
    await expect(run(supabase)).resolves.toBe(false);
  });

  it('never looks up or blocks a full-price line', async () => {
    const { supabase, rpc } = client(1500);
    await expect(run(supabase, [line(1000)])).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('ignores non-negotiable lines (rejected elsewhere)', async () => {
    const { supabase, rpc } = client(1500);
    await expect(run(supabase, [line(900, false)])).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not block when the product has no floor (unknown or inactive)', async () => {
    const { supabase } = client(null);
    await expect(run(supabase)).resolves.toBe(false);
  });

  it('throws instead of letting an unchecked discount through when the lookup fails', async () => {
    const { supabase } = client(null, { message: 'boom', code: 'XX000' });
    await expect(run(supabase)).rejects.toThrow(
      'Unable to load negotiation cost floor'
    );
  });
});
