import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadLatestPaystackOrderAccount } from './load-latest-paystack-order-account';

describe('loadLatestPaystackOrderAccount', () => {
  it('selects the newest Paystack assignment deterministically', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const query = {
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle,
      order: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
    };
    const supabase = {
      from: vi.fn().mockReturnValue(query),
    } as unknown as SupabaseClient;

    await loadLatestPaystackOrderAccount(supabase, 'order-1');

    expect(supabase.from).toHaveBeenCalledWith('order_payment_accounts');
    expect(query.eq).toHaveBeenNthCalledWith(1, 'order_id', 'order-1');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'provider', 'paystack');
    expect(query.order).toHaveBeenNthCalledWith(1, 'assigned_at', {
      ascending: false,
      nullsFirst: false,
    });
    expect(query.order).toHaveBeenNthCalledWith(2, 'created_at', {
      ascending: false,
    });
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(maybeSingle).toHaveBeenCalledOnce();
  });
});
