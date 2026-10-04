import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverPendingCheckoutOrder } from './recover-pending-checkout-order';
import { submitCheckoutOrder } from './submit-checkout-order';
import { persistPendingCheckoutOrder } from '../persist-pending-checkout-order';
import { runCheckoutOrderLifecycle } from './checkout-order-lifecycle';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';

vi.mock('./recover-pending-checkout-order', () => ({
  recoverPendingCheckoutOrder: vi.fn(),
}));
vi.mock('./submit-checkout-order', async (importOriginal) => {
  const original = await importOriginal<typeof import('./submit-checkout-order')>();
  return { ...original, submitCheckoutOrder: vi.fn() };
});
vi.mock('../persist-pending-checkout-order', () => ({
  persistPendingCheckoutOrder: vi.fn(),
}));
vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: vi.fn(),
}));

function lifecycleOptions(): Parameters<typeof runCheckoutOrderLifecycle>[0] {
  return {
    reuse: { paymentMethod: 'paystack' } as never,
    recoveryContext: {} as never,
    submit: {
      getIdempotencyKey: async () => 'key',
      orderRequest: {} as never,
      paymentMethod: 'paystack',
      total: 100,
      onVoucherRejected: vi.fn(),
      onPendingOrderInvalidated: vi.fn(async () => undefined),
      onShippingRateRejected: vi.fn(),
      getOrderErrorMessage: vi.fn(() => 'failed'),
    },
    customer: {
      email: 'ada@example.com',
      phone: '08000000000',
      merchantId: 'merchant-1',
    },
    fingerprint: 'fingerprint',
    paymentMethod: 'paystack',
    itemCount: 1,
    shipping: 0,
    subtotal: 100,
    tax: 0,
    fallbackTotal: 100,
    currencyFallback: 'NGN',
    shippingAddress: { address: '1 Main St', city: 'Lagos', state: 'Lagos' },
    merchantCountry: 'NG',
    onRedvaultSummary: vi.fn(),
    onOrderCreated: vi.fn(),
    onPendingSnapshot: vi.fn(),
    redvaultReview: {
      enabled: false,
      customerName: 'Ada Customer',
      checkoutFingerprint: 'fingerprint',
      setReady: vi.fn(),
      releaseSubmission: vi.fn(),
    },
  };
}

describe('runCheckoutOrderLifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists the authoritative order fence before returning for RedVault review', async () => {
    vi.mocked(recoverPendingCheckoutOrder).mockResolvedValue({
      kind: 'submit',
      pendingOrder: { reusableOrder: null, clearStoredOrder: false },
    });
    vi.mocked(submitCheckoutOrder).mockResolvedValue({
      order: {
        id: 'order-12345678',
        order_number: 'BC-123',
        tracking_token: 'tracking-token',
        currency: ' NGN ',
        total: 12500,
      },
      wallet: null,
      amountDueToGateway: 11000,
    });

    const events: string[] = [];
    const result = await runCheckoutOrderLifecycle({
      reuse: { paymentMethod: 'uba_redvault' } as never,
      recoveryContext: {} as never,
      submit: {
        getIdempotencyKey: async () => 'key',
        orderRequest: {} as never,
        paymentMethod: 'uba_redvault',
        total: 12500,
        onVoucherRejected: vi.fn(),
        onPendingOrderInvalidated: vi.fn(async () => undefined),
        onShippingRateRejected: vi.fn(),
        getOrderErrorMessage: vi.fn(() => 'failed'),
      },
      customer: {
        email: 'ada@example.com',
        phone: '08000000000',
        merchantId: 'merchant-1',
      },
      fingerprint: 'fingerprint',
      paymentMethod: 'uba_redvault',
      itemCount: 1,
      shipping: 500,
      subtotal: 12000,
      tax: 0,
      fallbackTotal: 12500,
      currencyFallback: 'USD',
      shippingAddress: { address: '1 Main St', city: 'Lagos', state: 'Lagos' },
      merchantCountry: 'NG',
      onRedvaultSummary: vi.fn(),
      onOrderCreated: () => events.push('order-created'),
      onPendingSnapshot: () => events.push('snapshot-set'),
      redvaultReview: {
        enabled: true,
        customerName: 'Ada Customer',
        checkoutFingerprint: 'fingerprint',
        setReady: () => events.push('review-ready'),
        releaseSubmission: () => events.push('released'),
      },
    });

    expect(result).toEqual({ kind: 'redvault_review' });
    expect(submitCheckoutOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedPendingOrder: { reusableOrder: null, clearStoredOrder: false },
      })
    );
    expect(persistPendingCheckoutOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-12345678',
        amountDueToGateway: 11000,
        paymentMethod: 'uba_redvault',
        merchantId: 'merchant-1',
      })
    );
    expect(events).toEqual([
      'order-created',
      'snapshot-set',
      'review-ready',
      'released',
    ]);
  });

  it('returns server order currency, gateway amount, and billing address for payment initialization', async () => {
    vi.mocked(recoverPendingCheckoutOrder).mockResolvedValue({
      kind: 'submit',
      pendingOrder: { reusableOrder: null, clearStoredOrder: false },
    });
    vi.mocked(submitCheckoutOrder).mockResolvedValue({
      order: { id: 'order-1', currency: 'EUR', total: 120 },
      wallet: { amountUsed: 30, newBalance: 70 },
      amountDueToGateway: 90,
    });

    const onPendingSnapshot = vi.fn();
    const onOrderCreated = vi.fn();
    const result = await runCheckoutOrderLifecycle({
      reuse: { paymentMethod: 'card' } as never,
      recoveryContext: {} as never,
      submit: {
        getIdempotencyKey: async () => 'key',
        orderRequest: {} as never,
        paymentMethod: 'paystack',
        total: 120,
        onVoucherRejected: vi.fn(),
        onPendingOrderInvalidated: vi.fn(async () => undefined),
        onShippingRateRejected: vi.fn(),
        getOrderErrorMessage: vi.fn(() => 'failed'),
      },
      customer: {
        email: 'ada@example.com',
        phone: '08000000000',
        merchantId: 'merchant-1',
      },
      fingerprint: 'fingerprint',
      paymentMethod: 'paystack',
      itemCount: 1,
      shipping: 0,
      subtotal: 120,
      tax: 0,
      fallbackTotal: 120,
      currencyFallback: 'NGN',
      shippingAddress: { address: '1 Main St', city: 'Lagos', state: 'Lagos' },
      merchantCountry: 'NG',
      onRedvaultSummary: vi.fn(),
      onOrderCreated,
      onPendingSnapshot,
      redvaultReview: {
        enabled: false,
        customerName: 'Ada Customer',
        checkoutFingerprint: 'fingerprint',
        setReady: vi.fn(),
        releaseSubmission: vi.fn(),
      },
    });

    expect(result).toMatchObject({
      kind: 'payment_ready',
      order: { id: 'order-1' },
      wallet: { amountUsed: 30, newBalance: 70 },
      amountDueToGateway: 90,
      orderChargeCurrency: 'EUR',
      billingAddress: {
        line1: '1 Main St',
        city: 'Lagos',
        state: 'Lagos',
        country: 'NG',
      },
    });
    expect(onPendingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethod: 'card' })
    );
    expect(onOrderCreated).toHaveBeenCalledWith({
      orderId: 'order-1',
      orderNumber: 'ORDER-1',
      currency: 'EUR',
    });
  });

  it('does not submit or persist when pending-order recovery handled the request', async () => {
    vi.mocked(recoverPendingCheckoutOrder).mockResolvedValue({
      kind: 'handled',
    });

    await expect(
      runCheckoutOrderLifecycle(lifecycleOptions())
    ).resolves.toEqual({ kind: 'handled' });

    expect(submitCheckoutOrder).not.toHaveBeenCalled();
    expect(persistPendingCheckoutOrder).not.toHaveBeenCalled();
  });

  it('keeps the created order fenced when a funnel event fails', async () => {
    vi.mocked(recoverPendingCheckoutOrder).mockResolvedValue({
      kind: 'submit',
      pendingOrder: { reusableOrder: null, clearStoredOrder: false },
    });
    vi.mocked(submitCheckoutOrder).mockResolvedValue({
      order: {
        id: 'order-12345678',
        order_number: 'BC-123',
        currency: 'NGN',
        total: 100,
      },
      wallet: null,
      amountDueToGateway: 100,
    });
    vi.mocked(captureCheckoutFunnelEventOnce).mockImplementation(() => {
      throw new Error('funnel unavailable');
    });
    const input = lifecycleOptions();

    await expect(runCheckoutOrderLifecycle(input)).resolves.toMatchObject({
      kind: 'payment_ready',
      order: { id: 'order-12345678' },
    });

    expect(input.onOrderCreated).toHaveBeenCalledWith({
      orderId: 'order-12345678',
      orderNumber: 'BC-123',
      currency: 'NGN',
    });
    expect(persistPendingCheckoutOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-12345678' })
    );
    expect(input.onPendingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-12345678' })
    );
  });
});
