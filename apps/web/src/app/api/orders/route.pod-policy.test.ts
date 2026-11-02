import { describe, expect, it, vi } from 'vitest';
import {
  authenticateApiRequest,
  POST,
} from './route.loyalty-bridge.mocks.test-support';
import {
  loyaltyRequest,
  setupLoyaltyBridge,
} from './route.loyalty-bridge.test-support';

describe('POST order POD policy', () => {
  it.each([
    { method: 'pod', guest: false },
    { method: 'pay_on_delivery', guest: false },
    { method: 'pod', guest: true },
    { method: 'pay_on_delivery', guest: true },
    { method: 'POD', guest: false },
    { method: 'Pay_On_Delivery', guest: true },
  ])('denies disabled $method for guest=$guest before order or money effects', async ({
    method,
    guest,
  }) => {
    const client = await setupLoyaltyBridge({
      get_storefront_payment_settings: {
        data: [{ pay_on_delivery_enabled: false }],
        error: null,
      },
    });
    if (guest)
      vi.mocked(authenticateApiRequest).mockResolvedValue({
        user: null,
        error: 'Not authenticated',
        supabase: null,
      });
    const response = await POST(loyaltyRequest({ payment_method: method }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: 'PAY_ON_DELIVERY_DISABLED',
      error: 'Pay on Delivery is not available for this store',
    });
    const calls = client.rpc.mock.calls.map(([name]) => name);
    expect(calls).not.toContain('create_storefront_order');
    expect(calls).not.toContain('redeem_wallet_for_order');
    expect(calls).not.toContain('redeem_savings_for_order');
    expect(calls).not.toContain(
      'claim_immediate_order_notification_with_proof'
    );
  });
  it('sends a canonical POD method to the order RPC', async () => {
    const client = await setupLoyaltyBridge({
      get_storefront_payment_settings: {
        data: [{ pay_on_delivery_enabled: true }],
        error: null,
      },
    });
    await POST(loyaltyRequest({ payment_method: 'POD' }));
    expect(client.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({ p_payment_method: 'pod' })
    );
  });
  it.each([
    true,
    false,
  ])('uses the scoped replay client for guest=%s', async (guest) => {
    const client = await setupLoyaltyBridge({
      get_storefront_payment_settings: {
        data: [{ pay_on_delivery_enabled: false }],
        error: null,
      },
      is_storefront_pod_order_idempotency_hash: { data: true, error: null },
    });
    if (guest)
      vi.mocked(authenticateApiRequest).mockResolvedValue({
        user: null,
        error: 'Not authenticated',
        supabase: null,
      });
    const scoped = {
      ...client,
      rpc: vi.fn((...args: Parameters<typeof client.rpc>) =>
        client.rpc(...args)
      ),
    };
    const { createStorefrontOrderRpcClient } = await import(
      '@/lib/checkout/storefront-order-rpc-client'
    );
    const factory = vi.mocked(createStorefrontOrderRpcClient);
    factory.mockReturnValue(scoped as never);
    try {
      await POST(loyaltyRequest({ payment_method: 'pod' }));
      expect(scoped.rpc).toHaveBeenCalledWith(
        'is_storefront_pod_order_idempotency_hash',
        expect.any(Object)
      );
      expect(
        client.rpc.mock.calls.filter(
          ([name]) => name === 'get_storefront_payment_settings'
        )
      ).toHaveLength(1);
      expect(factory).toHaveBeenCalledWith(
        expect.objectContaining({ userId: guest ? null : expect.any(String) })
      );
    } finally {
      factory.mockImplementation(({ fallbackClient }) => fallbackClient);
    }
  });
  it('maps a concurrent database policy rejection to a safe client error', async () => {
    await setupLoyaltyBridge({
      get_storefront_payment_settings: {
        data: [{ pay_on_delivery_enabled: true }],
        error: null,
      },
      create_storefront_order: {
        data: null,
        error: {
          code: 'P0001',
          message: 'pay_on_delivery_disabled',
          details: 'private database detail',
        },
      },
    });
    const response = await POST(loyaltyRequest({ payment_method: 'pod' }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: 'PAY_ON_DELIVERY_DISABLED',
      error: 'Pay on Delivery is not available for this store',
    });
  });
});
