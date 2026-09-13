import { describe, expect, it, vi } from 'vitest';
import {
  buildPendingCheckoutFingerprint,
  normalizeOrderPaymentMethod,
  resolvePendingCheckoutOrder,
  type PendingCheckoutOrderSnapshot,
} from './pending-checkout-order';

describe('pending-checkout-order', () => {
  it('keeps the REDVAULT order method distinct from generic card orders', () => {
    expect(normalizeOrderPaymentMethod('uba_redvault')).toBe('uba_redvault');
  });
  it.each(['uba_redvault', 'card'])('never reopens a stored REDVAULT order through generic reuse for %s', async paymentMethod => {
    const fetchImpl = vi.fn();
    const result = await resolvePendingCheckoutOrder({
      pendingOrder: {
        orderId: 'redvault-order', merchantId: 'merchant',
        customerEmail: 'ada@example.com', customerPhone: '', checkoutFingerprint: 'fingerprint',
        amountDueToGateway: 117.5, createdAt: '2026-09-12', paymentMethod: 'uba_redvault',
      },
      merchantId: 'merchant', customerEmail: 'ada@example.com',
      checkoutFingerprint: 'fingerprint', paymentMethod, shippingProvider: null, fetchImpl,
    });
    expect(result).toEqual({ reusableOrder: null, clearStoredOrder: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('preserves an ordinary pending snapshot when REDVAULT bypasses reuse', async () => {
    const fetchImpl = vi.fn();
    const result = await resolvePendingCheckoutOrder({
      pendingOrder: {
        orderId: 'ordinary-order', merchantId: 'merchant',
        customerEmail: 'ada@example.com', customerPhone: '', checkoutFingerprint: 'fingerprint',
        amountDueToGateway: 117.5, createdAt: '2026-09-12', paymentMethod: 'card',
      },
      merchantId: 'merchant', customerEmail: 'ada@example.com',
      checkoutFingerprint: 'fingerprint', paymentMethod: 'uba_redvault', shippingProvider: null, fetchImpl,
    });

    expect(result).toEqual({ reusableOrder: null, clearStoredOrder: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('maps payment methods to persisted order values', () => {
    expect(normalizeOrderPaymentMethod('paystack')).toBe('card');
    expect(normalizeOrderPaymentMethod('korapay')).toBe('card');
    expect(normalizeOrderPaymentMethod('klump')).toBe('klump');
    expect(normalizeOrderPaymentMethod('bank_transfer')).toBe('bank_transfer');
    expect(normalizeOrderPaymentMethod('payforme')).toBe('payforme');
    expect(normalizeOrderPaymentMethod('paypal')).toBe('paypal');
    expect(normalizeOrderPaymentMethod('pod')).toBe('pod');
  });

  it('builds the same fingerprint regardless of item order', () => {
    const base = {
      merchantId: 'merchant-1',
      customerEmail: 'John@example.com',
      customerName: 'John Doe',
      customerPhone: '+2348012345678',
      deliveryMethod: 'door',
      shippingFee: 2000,
      shippingProvider: 'GIGL',
      selectedQuoteId: 'quote-1',
      shippingAddress: {
        address: '123 Test Street',
        city: 'Ikeja',
        state: 'Lagos',
        phone: '+2348012345678',
      },
      useWalletCredit: false,
      walletAmountUsed: 0,
    } as const;

    const fingerprintA = buildPendingCheckoutFingerprint({
      ...base,
      items: [
        {
          product_id: 'product-b',
          name: 'Phone Case',
          quantity: 1,
          price: 5000,
        },
        {
          product_id: 'product-a',
          name: 'iPhone',
          quantity: 1,
          price: 100000,
        },
      ],
    });

    const fingerprintB = buildPendingCheckoutFingerprint({
      ...base,
      items: [
        {
          product_id: 'product-a',
          name: 'iPhone',
          quantity: 1,
          price: 100000,
        },
        {
          product_id: 'product-b',
          name: 'Phone Case',
          quantity: 1,
          price: 5000,
        },
      ],
    });

    expect(fingerprintA).toBe(fingerprintB);
  });

  it('reuses a matching unpaid pending order', async () => {
    const pendingOrder: PendingCheckoutOrderSnapshot = {
      orderId: 'order-123',
      orderNumber: 'ORD-123',
      trackingToken: 'tracking-token-123',
      merchantId: 'merchant-1',
      customerEmail: 'john@example.com',
      customerPhone: '+2348012345678',
      checkoutFingerprint: 'fingerprint-1',
      amountDueToGateway: 12000,
      createdAt: '2026-04-09T09:00:00.000Z',
    };

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'order-123',
          total: 12000,
          payment_status: 'pending',
          shipping_status: 'pending',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          order: {
            id: 'order-123',
            order_number: 'ORD-123',
            tracking_token: 'tracking-token-123',
          },
        }),
      } as Response);

    const result = await resolvePendingCheckoutOrder({
      pendingOrder,
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      customerEmail: 'john@example.com',
      checkoutFingerprint: 'fingerprint-1',
      paymentMethod: 'card',
      shippingProvider: 'GIGL',
      selectedQuoteId: 'quote-1',
      fetchImpl,
    });

    expect(result).toEqual({
      reusableOrder: {
        order: {
          id: 'order-123',
          order_number: 'ORD-123',
          tracking_token: 'tracking-token-123',
        },
        amountDueToGateway: 12000,
      },
      clearStoredOrder: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('omits selected_quote_id from the reuse request when none is forwarded (merchant-rate path)', async () => {
    // Merchant-rate checkouts pass `selectedQuoteId: undefined` (the synthetic
    // `mrate_<uuid>` id is never forwarded) so the reuse route — whose schema
    // validates `selected_quote_id` as a UUID — does not 400 and clear the
    // stored pending order.
    const pendingOrder: PendingCheckoutOrderSnapshot = {
      orderId: 'order-123',
      orderNumber: 'ORD-123',
      trackingToken: 'tracking-token-123',
      merchantId: 'merchant-1',
      customerEmail: 'john@example.com',
      customerPhone: '+2348012345678',
      checkoutFingerprint: 'fingerprint-1',
      amountDueToGateway: 12000,
      createdAt: '2026-04-09T09:00:00.000Z',
    };

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'order-123',
          total: 12000,
          payment_status: 'pending',
          shipping_status: 'pending',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          order: {
            id: 'order-123',
            order_number: 'ORD-123',
            tracking_token: 'tracking-token-123',
          },
        }),
      } as Response);

    const result = await resolvePendingCheckoutOrder({
      pendingOrder,
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      customerEmail: 'john@example.com',
      checkoutFingerprint: 'fingerprint-1',
      paymentMethod: 'card',
      shippingProvider: null,
      selectedQuoteId: undefined,
      fetchImpl,
    });

    const reuseCall = fetchImpl.mock.calls.find(
      ([url]) => String(url) === '/api/orders/reuse',
    );
    const reuseBody = JSON.parse(String(reuseCall?.[1]?.body));

    expect(reuseBody.selected_quote_id).toBeUndefined();
    expect(String(reuseCall?.[1]?.body)).not.toContain('mrate_');
    expect(result.reusableOrder?.order.id).toBe('order-123');
    expect(result.clearStoredOrder).toBe(false);
  });

  it('forwards the bare merchant rate id in the reuse request (R14-3)', async () => {
    // A merchant-rate reuse omits selected_quote_id (its `mrate_` id is not a
    // uuid) but forwards the BARE rate uuid so the reuse route can re-stamp the
    // fulfillment provider/rate-name if the original stamp failed.
    const pendingOrder: PendingCheckoutOrderSnapshot = {
      orderId: 'order-123',
      orderNumber: 'ORD-123',
      trackingToken: 'tracking-token-123',
      merchantId: 'merchant-1',
      customerEmail: 'john@example.com',
      customerPhone: '+2348012345678',
      checkoutFingerprint: 'fingerprint-1',
      amountDueToGateway: 12000,
      createdAt: '2026-04-09T09:00:00.000Z',
    };

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'order-123',
          total: 12000,
          payment_status: 'pending',
          shipping_status: 'pending',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          order: {
            id: 'order-123',
            order_number: 'ORD-123',
            tracking_token: 'tracking-token-123',
          },
        }),
      } as Response);

    await resolvePendingCheckoutOrder({
      pendingOrder,
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      customerEmail: 'john@example.com',
      checkoutFingerprint: 'fingerprint-1',
      paymentMethod: 'card',
      shippingProvider: null,
      selectedQuoteId: undefined,
      shippingRateId: '123e4567-e89b-12d3-a456-426614174777',
      fetchImpl,
    });

    const reuseCall = fetchImpl.mock.calls.find(
      ([url]) => String(url) === '/api/orders/reuse',
    );
    const reuseBody = JSON.parse(String(reuseCall?.[1]?.body));

    expect(reuseBody.shipping_rate_id).toBe(
      '123e4567-e89b-12d3-a456-426614174777',
    );
    expect(reuseBody.selected_quote_id).toBeUndefined();
  });

  it('omits shipping_rate_id from the reuse request when no merchant rate is forwarded', async () => {
    const pendingOrder: PendingCheckoutOrderSnapshot = {
      orderId: 'order-123',
      orderNumber: 'ORD-123',
      trackingToken: 'tracking-token-123',
      merchantId: 'merchant-1',
      customerEmail: 'john@example.com',
      customerPhone: '+2348012345678',
      checkoutFingerprint: 'fingerprint-1',
      amountDueToGateway: 12000,
      createdAt: '2026-04-09T09:00:00.000Z',
    };

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'order-123',
          total: 12000,
          payment_status: 'pending',
          shipping_status: 'pending',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          order: { id: 'order-123' },
        }),
      } as Response);

    await resolvePendingCheckoutOrder({
      pendingOrder,
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      customerEmail: 'john@example.com',
      checkoutFingerprint: 'fingerprint-1',
      paymentMethod: 'card',
      shippingProvider: 'GIGL',
      selectedQuoteId: 'quote-1',
      fetchImpl,
    });

    const reuseCall = fetchImpl.mock.calls.find(
      ([url]) => String(url) === '/api/orders/reuse',
    );
    const reuseBody = JSON.parse(String(reuseCall?.[1]?.body));

    expect(reuseBody.shipping_rate_id).toBeUndefined();
  });

  it('preserves zero gateway amount when reusing an order', async () => {
    const pendingOrder: PendingCheckoutOrderSnapshot = {
      orderId: 'order-123',
      orderNumber: 'ORD-123',
      trackingToken: 'tracking-token-123',
      merchantId: 'merchant-1',
      customerEmail: 'john@example.com',
      customerPhone: '+2348012345678',
      checkoutFingerprint: 'fingerprint-1',
      amountDueToGateway: 0,
      createdAt: '2026-04-09T09:00:00.000Z',
    };

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'order-123',
          total: 12000,
          payment_status: 'pending',
          shipping_status: 'pending',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          order: {
            id: 'order-123',
            order_number: 'ORD-123',
            tracking_token: 'tracking-token-123',
          },
        }),
      } as Response);

    const result = await resolvePendingCheckoutOrder({
      pendingOrder,
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      customerEmail: 'john@example.com',
      checkoutFingerprint: 'fingerprint-1',
      paymentMethod: 'card',
      shippingProvider: 'GIGL',
      selectedQuoteId: 'quote-1',
      fetchImpl,
    });

    expect(result).toEqual({
      reusableOrder: {
        order: {
          id: 'order-123',
          order_number: 'ORD-123',
          tracking_token: 'tracking-token-123',
        },
        amountDueToGateway: 0,
      },
      clearStoredOrder: false,
    });
  });

  it('clears the stored order when shipping has been cancelled', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'order-123',
        total: 12000,
        payment_status: 'pending',
        shipping_status: 'cancelled',
      }),
    } as Response);

    const result = await resolvePendingCheckoutOrder({
      pendingOrder: {
        orderId: 'order-123',
        trackingToken: 'tracking-token-123',
        merchantId: 'merchant-1',
        customerEmail: 'john@example.com',
        customerPhone: '+2348012345678',
        checkoutFingerprint: 'fingerprint-1',
        amountDueToGateway: 12000,
        createdAt: '2026-04-09T09:00:00.000Z',
      },
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      customerEmail: 'john@example.com',
      checkoutFingerprint: 'fingerprint-1',
      paymentMethod: 'card',
      shippingProvider: 'GIGL',
      fetchImpl,
    });

    expect(result).toEqual({
      reusableOrder: null,
      clearStoredOrder: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(['paid', 'bnpl_approved', 'refunded'])(
    'clears a locally pending order when payment status is %s',
    async (paymentStatus) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'order-123',
          payment_status: paymentStatus,
          shipping_status: 'pending',
          total: 1000,
        }),
      } as Response);

      const result = await resolvePendingCheckoutOrder({
        pendingOrder: {
          orderId: 'order-123',
          orderNumber: 'ORD-123',
          trackingToken: 'tracking-token-123',
          merchantId: 'merchant-1',
          customerEmail: 'ada@example.com',
          customerPhone: '+2348123456789',
          checkoutFingerprint: 'fingerprint-1',
          amountDueToGateway: 1000,
          createdAt: '2026-05-28T00:00:00.000Z',
        },
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        customerEmail: 'ada@example.com',
        checkoutFingerprint: 'fingerprint-1',
        paymentMethod: 'credit_direct',
        shippingProvider: 'GIGL',
        fetchImpl,
      });

      expect(result).toEqual({ reusableOrder: null, clearStoredOrder: true });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  );

  it('clears the stored order when the fingerprint no longer matches', async () => {
    const result = await resolvePendingCheckoutOrder({
      pendingOrder: {
        orderId: 'order-123',
        trackingToken: 'tracking-token-123',
        merchantId: 'merchant-1',
        customerEmail: 'john@example.com',
        customerPhone: '+2348012345678',
        checkoutFingerprint: 'old-fingerprint',
        amountDueToGateway: 12000,
        createdAt: '2026-04-09T09:00:00.000Z',
      },
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      customerEmail: 'john@example.com',
      checkoutFingerprint: 'new-fingerprint',
      paymentMethod: 'card',
      shippingProvider: 'GIGL',
      fetchImpl: vi.fn<typeof fetch>(),
    });

    expect(result).toEqual({
      reusableOrder: null,
      clearStoredOrder: true,
    });
  });
});

describe('abandoned payment validation failures', () => {
  it.each([400, 403, 409, 429, 500])('retains the existing order when reopening returns %s instead of creating a duplicate', async (status) => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'order-1', payment_status: 'pending', shipping_status: 'pending', total: 12000 }) } as Response)
      .mockResolvedValueOnce({ ok: false, status } as Response);
    await expect(resolvePendingCheckoutOrder({
      pendingOrder: { orderId: 'order-1', trackingToken: 'token', merchantId: 'merchant-1', customerEmail: 'qa@example.com', customerPhone: '+2348034096325', checkoutFingerprint: 'same-checkout', amountDueToGateway: 12000, createdAt: '2026-09-07' },
      merchantId: 'merchant-1', customerEmail: 'qa@example.com', checkoutFingerprint: 'same-checkout', paymentMethod: 'card', shippingProvider: 'GIGL', selectedQuoteId: 'refreshed-quote', fetchImpl,
    })).rejects.toThrow('Failed to reopen pending checkout order');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
