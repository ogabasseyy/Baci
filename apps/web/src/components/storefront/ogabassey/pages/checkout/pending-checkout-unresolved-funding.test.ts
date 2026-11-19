import { describe, expect, it, vi } from 'vitest';
import { oxygenPreviousPaymentUnresolved } from './pending-checkout-oxygen-fence';
import {
  recoverUnresolvedFundingOrder,
  unresolvedFundingOrderMessage,
} from './pending-checkout-unresolved-funding';

describe('recoverUnresolvedFundingOrder', () => {
  it('returns null when no matching unresolved funding fence is active', async () => {
    const fetchImpl = vi.fn();

    await expect(
      recoverUnresolvedFundingOrder({
        pendingOrder: null,
        merchantId: 'merchant-1',
        customerEmail: 'ada@example.com',
        checkoutFingerprint: 'fp-1',
        paymentMethod: 'paystack',
        shippingProvider: null,
        fetchImpl,
      })
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('clears the stored order and returns paidOrder when the fenced order is already paid', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'order-1',
          order_number: 'ORD-100',
          payment_status: 'paid',
          shipping_status: 'pending',
          total: 5000,
        }),
        { status: 200 }
      )
    );

    const result = await recoverUnresolvedFundingOrder({
      pendingOrder: {
        orderId: 'order-1',
        orderNumber: 'ORD-100',
        trackingToken: 'tok-1',
        merchantId: 'merchant-1',
        customerEmail: 'ada@example.com',
        customerPhone: '08000000000',
        checkoutFingerprint: 'fp-1',
        paymentMethod: 'paystack',
        amountDueToGateway: 5000,
        fundingUnresolved: true,
        createdAt: '2026-11-19T00:00:00.000Z',
      },
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      customerEmail: 'ada@example.com',
      checkoutFingerprint: 'fp-1',
      paymentMethod: 'paystack',
      shippingProvider: null,
      fetchImpl,
    });

    expect(result).toEqual({
      reusableOrder: null,
      clearStoredOrder: true,
      paidOrder: {
        orderId: 'order-1',
        orderNumber: 'ORD-100',
        trackingToken: 'tok-1',
        customerEmail: 'ada@example.com',
      },
    });
  });

  it('throws the oxygen fence error when unresolved funding is an oxygen order', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 404 }));

    await expect(
      recoverUnresolvedFundingOrder({
        pendingOrder: {
          orderId: 'order-1',
          trackingToken: 'tok-1',
          merchantId: 'merchant-1',
          customerEmail: 'ada@example.com',
          customerPhone: '08000000000',
          checkoutFingerprint: 'fp-1',
          paymentMethod: 'oxygen',
          amountDueToGateway: 5000,
          fundingUnresolved: true,
          fundingRetryable: false,
          createdAt: '2026-11-19T00:00:00.000Z',
        },
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        customerEmail: 'ada@example.com',
        checkoutFingerprint: 'fp-1',
        paymentMethod: 'paystack',
        shippingProvider: null,
        fetchImpl,
      })
    ).rejects.toThrow(oxygenPreviousPaymentUnresolved);
  });

  it('throws generic unresolved funding guidance when retry is unavailable', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 404 }));

    await expect(
      recoverUnresolvedFundingOrder({
        pendingOrder: {
          orderId: 'order-1',
          trackingToken: 'tok-1',
          merchantId: 'merchant-1',
          customerEmail: 'ada@example.com',
          customerPhone: '08000000000',
          checkoutFingerprint: 'fp-1',
          paymentMethod: 'paystack',
          amountDueToGateway: 5000,
          fundingUnresolved: true,
          fundingRetryable: true,
          createdAt: '2026-11-19T00:00:00.000Z',
        },
        merchantId: 'merchant-1',
        merchantSlug: 'ogabassey',
        customerEmail: 'ada@example.com',
        checkoutFingerprint: 'fp-1',
        paymentMethod: 'paystack',
        shippingProvider: null,
        fetchImpl,
      })
    ).rejects.toThrow(unresolvedFundingOrderMessage);
  });
});
