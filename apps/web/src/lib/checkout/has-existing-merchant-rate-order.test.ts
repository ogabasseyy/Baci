import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { hasExistingMerchantRateOrder } from './has-existing-merchant-rate-order';

const MERCHANT_ID = '11111111-1111-1111-1111-111111111111';

function adminClient(data: unknown, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const byKey = vi.fn().mockReturnValue({ maybeSingle });
  const byMerchant = vi.fn().mockReturnValue({ eq: byKey });
  const select = vi.fn().mockReturnValue({ eq: byMerchant });
  const from = vi.fn().mockReturnValue({ select });

  return {
    client: { from } as unknown as SupabaseClient,
    from,
    select,
  };
}

describe('hasExistingMerchantRateOrder', () => {
  it('returns true when the merchant-scoped idempotency row exists', async () => {
    const client = adminClient({ id: 'order-1' });

    await expect(
      hasExistingMerchantRateOrder({
        adminSupabase: client.client,
        merchantId: MERCHANT_ID,
        requestIdempotencyKey: 'checkout-1',
        shippingRateId: 'rate-1',
      })
    ).resolves.toBe(true);
    expect(client.from).toHaveBeenCalledWith('orders');
    expect(client.select).toHaveBeenCalledWith('id');
  });

  it('falls back to current rate verification when the lookup fails', async () => {
    const client = adminClient(null, new Error('database unavailable'));

    await expect(
      hasExistingMerchantRateOrder({
        adminSupabase: client.client,
        merchantId: MERCHANT_ID,
        requestIdempotencyKey: 'checkout-1',
        shippingRateId: 'rate-1',
      })
    ).resolves.toBe(false);
  });
});
