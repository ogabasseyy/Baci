import { describe, expect, it, vi } from 'vitest';
import {
  buildCheckoutOrderLifecycleOptions,
  type BuildCheckoutOrderLifecycleOptionsInput,
} from './build-checkout-order-lifecycle-options';
import type { CartItem } from '@/hooks/cart';

function input(cart: CartItem[] = []) {
  return {
    prepared: {
      kind: 'ready',
      delivery: {
        address: {
          address: '12 Broad Street',
          city: 'Lagos Island',
          state: 'Lagos',
          phone: '08000000000',
          countryCode: 'NG',
          country: 'Nigeria',
        },
        finalAddress: '12 Broad Street',
        finalCity: 'Lagos Island',
        finalState: 'Lagos',
        merchantRateId: 'rate-123',
        shippingProvider: 'gigl',
      },
      identity: {
        items: [
          { product_id: 'product-1', quantity: 2, price: 500 },
          { product_id: 'product-2', quantity: 1, price: 700 },
        ],
        normalizedPaymentMethod: 'card',
        checkoutFingerprint: 'prepared-fingerprint',
      },
    },
    state: {
      pendingOrder: { orderId: 'pending-order' },
      merchant: { id: 'merchant-1', slug: 'test-store' },
      customer: {
        email: 'ada@example.com',
        phone: '08000000000',
        name: 'Ada-Eze Okon',
        firstName: 'Ada-Eze',
        lastName: 'Okon',
        userId: 'customer-1',
      },
      newsletterOptIn: true,
      paymentMethod: 'paystack',
      total: 2_200,
      orderRequestSubtotal: 1_700,
      subtotal: 1_600,
      shipping: 500,
      tax: 0,
      giftWrappingCost: 0,
      discountAmount: 0,
      useWalletCredit: false,
      walletAmountUsed: 0,
      currency: 'NGN',
      deliveryMethod: 'door',
      airportType: 'delivery',
      selectedQuoteId: 'mrate_rate-123',
      selectedQuoteMatchesMethod: true,
      merchantCountry: 'NG',
    },
    actions: {
      getIdempotencyKey: vi.fn(async () => 'idempotency-key'),
      cart,
      removeFromCart: vi.fn(),
      clearPendingCheckoutOrder: vi.fn(),
      clearCheckoutIdempotencyKey: vi.fn(async () => undefined),
      onShippingRateRejected: vi.fn(),
      getOrderErrorMessage: vi.fn(() => 'Order failed'),
      waitForResolvedCustomerAuth: vi.fn(async () => true),
      isOrderInFlightRef: { current: true },
      setIsProcessing: vi.fn(),
      setRedvaultStatus: vi.fn(),
      clearCheckoutSession: vi.fn(),
      clearCart: vi.fn(),
      pushSuccessRoute: vi.fn(),
      onRedvaultSummary: vi.fn(),
      onOrderCreated: vi.fn(),
      onPendingSnapshot: vi.fn(),
      setRedvaultOrderReady: vi.fn(),
      releaseSubmission: vi.fn(),
    },
    redvault: {
      enabled: false,
      customerName: 'Ada-Eze Okon',
    },
  } as unknown as BuildCheckoutOrderLifecycleOptionsInput;
}

describe('buildCheckoutOrderLifecycleOptions', () => {
  it('keeps the prepared delivery and identity authoritative across reuse and order creation', () => {
    const options = buildCheckoutOrderLifecycleOptions(input());

    expect(options.reuse).toMatchObject({
      pendingOrder: { orderId: 'pending-order' },
      merchantId: 'merchant-1',
      merchantSlug: 'test-store',
      customerEmail: 'ada@example.com',
      checkoutFingerprint: 'prepared-fingerprint',
      paymentMethod: 'card',
      shippingProvider: 'gigl',
      shippingRateId: 'rate-123',
      selectedQuoteId: undefined,
    });
    expect(options.recoveryContext).toMatchObject({
      firstName: 'Ada-Eze',
      lastName: 'Okon',
      finalAddress: '12 Broad Street',
      finalCity: 'Lagos Island',
      finalState: 'Lagos',
    });
    expect(options.submit.orderRequest).toMatchObject({
      merchant_id: 'merchant-1',
      customer_email: 'ada@example.com',
      customer_name: 'Ada-Eze Okon',
      payment_method: 'card',
      expected_total: 2_200,
      shipping_provider: 'gigl',
      shipping_rate_id: 'rate-123',
      selected_quote_id: null,
      accepts_marketing: true,
    });
    expect(options.itemCount).toBe(3);
    expect(options.fallbackTotal).toBe(2_200);
    expect(options.subtotal).toBe(1_600);
    expect(options.currencyFallback).toBe('NGN');
  });

  it('forwards only a currently matching airport quote', () => {
    const prepared = input();
    prepared.state.deliveryMethod = 'airport';
    prepared.state.selectedQuoteId = 'airport-quote-1';
    prepared.state.selectedQuoteMatchesMethod = false;
    const mismatched = buildCheckoutOrderLifecycleOptions(prepared);
    expect(mismatched.reuse.selectedQuoteId).toBeUndefined();
    expect(mismatched.submit.orderRequest.selected_quote_id).toBeNull();

    prepared.state.selectedQuoteMatchesMethod = true;
    const matching = buildCheckoutOrderLifecycleOptions(prepared);
    expect(matching.reuse.selectedQuoteId).toBe('airport-quote-1');
    expect(matching.submit.orderRequest.selected_quote_id).toBe(
      'airport-quote-1'
    );
  });

  it('uses the frozen prepared fingerprint and delivery values', () => {
    const prepared = input();
    prepared.prepared.delivery.merchantRateId = 'prepared-rate';
    prepared.prepared.delivery.shippingProvider = 'prepared-provider';

    const options = buildCheckoutOrderLifecycleOptions(prepared);

    expect(options.reuse).toMatchObject({
      checkoutFingerprint: 'prepared-fingerprint',
      shippingProvider: 'prepared-provider',
      shippingRateId: 'prepared-rate',
    });
    expect(options.fingerprint).toBe('prepared-fingerprint');
    expect(options.redvaultReview.checkoutFingerprint).toBe(
      'prepared-fingerprint'
    );
  });

  it('clears the pending attempt and matching idempotency key after invalidation', async () => {
    const prepared = input();
    const options = buildCheckoutOrderLifecycleOptions(prepared);

    await options.submit.onPendingOrderInvalidated();

    expect(prepared.actions.clearPendingCheckoutOrder).toHaveBeenCalledOnce();
    expect(prepared.actions.clearCheckoutIdempotencyKey).toHaveBeenCalledOnce();
  });

  it('removes only the voucher line identified as rejected by the order API', () => {
    const rejectedLine = {
      id: 'product-1',
      cartItemId: 'cart-line-1',
      quizVoucherToken: 'expired-token',
    } as unknown as CartItem;
    const prepared = input([rejectedLine]);
    const options = buildCheckoutOrderLifecycleOptions(prepared);

    options.submit.onVoucherRejected({
      details: 'quiz_voucher_token_expired',
      rejectedVoucherToken: 'expired-token',
    });

    expect(prepared.actions.removeFromCart).toHaveBeenCalledOnce();
    expect(prepared.actions.removeFromCart).toHaveBeenCalledWith('cart-line-1');
  });
});
