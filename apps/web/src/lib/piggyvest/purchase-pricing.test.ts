import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { createAuthenticatedPurchasePricing } from './purchase-pricing';

vi.mock('server-only', () => ({}));
it('authenticates before parsing or resolving any pricing source', async () => {
  const from = vi.fn();
  const execute = vi.fn();
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    from,
  } as unknown as SupabaseClient;
  expect(
    await createAuthenticatedPurchasePricing({
      supabase,
      configuration: {},
      goalId: 'bad',
      execute,
    }).publish({ price: 1 })
  ).toEqual({ status: 'unavailable' });
  expect(from).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});
it('rejects client prices and delivery amounts before RLS reads', async () => {
  const from = vi.fn();
  const execute = vi.fn();
  const identifier = '30000000-0000-4000-8000-000000000001';
  const supabase = {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: identifier } }, error: null }),
    },
    from,
  } as unknown as SupabaseClient;
  expect(
    await createAuthenticatedPurchasePricing({
      supabase,
      configuration: {},
      goalId: identifier,
      execute,
    }).publish({
      quoteId: identifier,
      shippingRateId: identifier,
      savingsKobo: 100,
      deliveryKobo: 0,
    })
  ).toEqual({ status: 'unavailable' });
  expect(from).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});
