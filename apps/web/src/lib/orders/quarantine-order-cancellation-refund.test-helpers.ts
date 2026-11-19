import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

export const transaction = {
  amount: 100,
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: 'PAY-123',
  id: 'payment-id',
};
export const order = {
  currency: 'NGN',
  id: 'order-id',
  merchant_id: 'merchant-id',
};

/** Supabase stub whose review insert hits the unique-conflict path. */
export function conflictingSupabase(mergeResult: boolean) {
  const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
  const rpc = vi.fn().mockResolvedValue({ data: mergeResult, error: null });
  const supabase = {
    from: vi.fn().mockReturnValue({ insert }),
    rpc,
  } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>;
  return { insert, rpc, supabase };
}
