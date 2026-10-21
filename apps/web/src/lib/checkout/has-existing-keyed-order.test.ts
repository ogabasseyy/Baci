import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { hasExistingKeyedOrder } from './has-existing-keyed-order';

const merchantId = '123e4567-e89b-12d3-a456-426614174000';

function rpcClient(outcome: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(outcome),
  } as unknown as SupabaseClient;
}

describe('hasExistingKeyedOrder', () => {
  it('returns true only when the merchant-scoped key already has an order', async () => {
    const supabase = rpcClient({ data: true, error: null });

    const result = await hasExistingKeyedOrder({
      merchantId,
      requestIdempotencyKey: 'retry-key',
      supabase,
    });

    expect(result).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'has_storefront_order_idempotency_key',
      {
        p_checkout_idempotency_key: 'retry-key',
        p_merchant_id: merchantId,
      }
    );
  });

  it('returns false for a first attempt without a stored key', async () => {
    const supabase = rpcClient({ data: false, error: null });

    await expect(
      hasExistingKeyedOrder({
        merchantId,
        requestIdempotencyKey: 'first-attempt-key',
        supabase,
      })
    ).resolves.toBe(false);
  });

  it('fails soft to full validation when the probe errors', async () => {
    const supabase = rpcClient({
      data: null,
      error: new Error('probe unavailable'),
    });

    await expect(
      hasExistingKeyedOrder({
        merchantId,
        requestIdempotencyKey: 'retry-key',
        supabase,
      })
    ).resolves.toBe(false);
  });

  it('skips the probe when no idempotency key was sent', async () => {
    const supabase = rpcClient({ data: true, error: null });

    await expect(
      hasExistingKeyedOrder({
        merchantId,
        requestIdempotencyKey: null,
        supabase,
      })
    ).resolves.toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
