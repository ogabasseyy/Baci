import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { hasExistingStorefrontOrderForKey } from './has-existing-storefront-order';

const MERCHANT_ID = '11111111-1111-1111-1111-111111111111';

function rpcClient(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });

  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
  };
}

describe('hasExistingStorefrontOrderForKey', () => {
  it('returns true when the merchant-scoped idempotency key exists', async () => {
    const client = rpcClient(true);

    await expect(
      hasExistingStorefrontOrderForKey({
        merchantId: MERCHANT_ID,
        requestIdempotencyKey: 'checkout-1',
        supabase: client.client,
      })
    ).resolves.toBe(true);
    expect(client.rpc).toHaveBeenCalledWith(
      'has_storefront_order_idempotency_key',
      {
        p_checkout_idempotency_key: 'checkout-1',
        p_merchant_id: MERCHANT_ID,
      }
    );
  });

  it('falls back to full validation when the probe fails', async () => {
    const client = rpcClient(null, new Error('database unavailable'));

    await expect(
      hasExistingStorefrontOrderForKey({
        merchantId: MERCHANT_ID,
        requestIdempotencyKey: 'checkout-1',
        supabase: client.client,
      })
    ).resolves.toBe(false);
  });
});
