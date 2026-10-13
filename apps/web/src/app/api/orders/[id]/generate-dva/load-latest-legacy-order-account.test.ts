import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadLatestLegacyOrderAccount } from './load-latest-legacy-order-account';

describe('loadLatestLegacyOrderAccount', () => {
  it('selects the newest non-Paystack account', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const query = {
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle,
      neq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
    };
    const supabase = {
      from: vi.fn().mockReturnValue(query),
    } as unknown as SupabaseClient;

    await loadLatestLegacyOrderAccount(supabase, 'order-1');

    expect(supabase.from).toHaveBeenCalledWith('order_payment_accounts');
    expect(query.eq).toHaveBeenCalledWith('order_id', 'order-1');
    expect(query.neq).toHaveBeenCalledWith('provider', 'paystack');
    expect(query.order).toHaveBeenCalledWith('created_at', {
      ascending: false,
    });
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(maybeSingle).toHaveBeenCalledOnce();
  });
});
