import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type FilterRow, matchesOrFilter } from '../test/postgrest-filter';

/** Holder so the hoisted mock factory can publish the fake back to the tests. */
const holder = vi.hoisted(() => ({
  fake: null as ReturnType<
    typeof import('../test/mocks/supabase-order-query-fake').createSupabaseOrderQueryFake
  > | null,
}));

vi.mock('@/lib/supabase', async () => {
  const { createSupabaseOrderQueryFake } = await import(
    '../test/mocks/supabase-order-query-fake'
  );
  holder.fake = createSupabaseOrderQueryFake([]);
  return { supabase: { from: () => holder.fake?.from() } };
});

vi.mock('./useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn((config) => config),
}));

import { useFailedOrders } from './useFailedOrders';

const NOW = '2026-06-02T02:00:00.000Z';
const STALE_CREATED_AT = '2026-06-01T02:00:00.000Z';

/** The or() filter the follow-up query actually applies. */
async function followUpFilter(): Promise<string> {
  const fake = holder.fake;
  if (!fake) throw new Error('supabase fake was not initialised');
  // biome-ignore lint/correctness/useHookAtTopLevel: useQuery is mocked to return its config object, so this is a plain call
  const query = useFailedOrders() as unknown as {
    queryFn: () => Promise<unknown>;
  };
  await query.queryFn();
  const orCall = fake.calls.find((call) => call.method === 'or');
  if (!orCall) throw new Error('follow-up query applied no or() filter');
  return String(orCall.args[0]);
}

const staleCheckout: FilterRow = {
  created_at: STALE_CREATED_AT,
  payment_method: 'bank_transfer',
  recorded_by_user_id: null,
  source: 'online_store',
};

describe('bugfix: staff invoices treated as abandoned checkouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    holder.fake?.reset([]);
  });

  describe.each(['pending', 'unpaid'])('a stale %s order', (paymentStatus) => {
    it.each<[string, FilterRow]>([
      [
        'a staff invoice',
        { recorded_by_user_id: 'staff-user-1', source: 'physical' },
      ],
      [
        'a staff order recorded against a checkout channel',
        { recorded_by_user_id: 'staff-user-1' },
      ],
      ['a WhatsApp order with a cleared creator', { source: 'whatsapp' }],
    ])('keeps %s out of follow-up', async (_label, overrides) => {
      const row = {
        ...staleCheckout,
        payment_status: paymentStatus,
        ...overrides,
      };

      expect(matchesOrFilter(row, await followUpFilter())).toBe(false);
    });

    it.each<[string, string | null]>([
      ['the online store', 'online_store'],
      ['a legacy website', 'website'],
      ['a blank', null],
    ])('still follows up a customer checkout from %s source', async (_label, source) => {
      const row = { ...staleCheckout, payment_status: paymentStatus, source };

      expect(matchesOrFilter(row, await followUpFilter())).toBe(true);
    });
  });

  it('still follows up a staff invoice whose payment failed', async () => {
    const row = {
      ...staleCheckout,
      payment_status: 'failed',
      recorded_by_user_id: 'staff-user-1',
      source: 'physical',
    };

    expect(matchesOrFilter(row, await followUpFilter())).toBe(true);
  });
});
