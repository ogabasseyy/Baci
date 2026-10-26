import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { seedOAuthGuestCart } from './guest-oauth-cart-seed';
it('seeds empty carts through the merchant-scoped OAuth worker before canonical migration', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  await seedOAuthGuestCart({ rpc } as unknown as SupabaseClient, 'merchant', 'private', 'expiry');
  expect(rpc).toHaveBeenCalledWith('mcp_guest_oauth_seed_cart', {
    p_merchant_id: 'merchant', p_token: 'private', p_expires_at: 'expiry',
  });
});
it.each([{ data: false, error: null }, { data: null, error: { message: 'secret SQL' } }])('fails closed without leaking storage details', async (reply) => {
  const rpc = vi.fn().mockResolvedValue(reply);
  await expect(seedOAuthGuestCart({ rpc } as unknown as SupabaseClient, 'merchant', 'private', 'expiry')).rejects.toThrow('OAuth storage unavailable');
});
