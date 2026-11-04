import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn().mockResolvedValue(null),
  toUserAccess: vi.fn(),
}));

import { resolveOxygenOrderContext } from './context';

const id = '123e4567-e89b-12d3-a456-426614174001';
const customerId = '123e4567-e89b-12d3-a456-426614174003';
afterEach(() => vi.clearAllMocks());
it.each([
  { id: null, merchant_id: id, customer_id: customerId },
  { id, merchant_id: 42, customer_id: customerId },
  { id, merchant_id: id },
])('rejects malformed order storage rows before any access proof', async (order) => {
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn().mockResolvedValue({
        data: table === 'orders' ? order : { id: customerId },
        error: null,
      }),
    };
    return query;
  });
  await expect(
    resolveOxygenOrderContext({ from } as unknown as SupabaseClient, id, id)
  ).rejects.toThrow();
  expect(from).toHaveBeenCalledExactlyOnceWith('orders');
});
it('rejects malformed customer storage rows instead of passing them to authorization', async () => {
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn().mockResolvedValue({
        data:
          table === 'orders'
            ? { id, merchant_id: id, customer_id: customerId }
            : { id: 42 },
        error: null,
      }),
    };
    return query;
  });
  await expect(
    resolveOxygenOrderContext({ from } as unknown as SupabaseClient, id, id)
  ).rejects.toThrow();
});
