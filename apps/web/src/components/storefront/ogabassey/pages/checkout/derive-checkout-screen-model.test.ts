import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveCheckoutScreenModel } from './derive-checkout-screen-model';
import {
  handlePlaceOrder,
  makeInput,
  onConfirmTransfer,
  onReturnToCart,
  paymentSession,
  setNewsletterOptIn,
  setPayWithWallet,
} from './derive-checkout-screen-model.test-support';
import type { ResumedOrder } from './types';

beforeEach(() => vi.clearAllMocks());

describe('deriveCheckoutScreenModel', () => {
  it('offers eligible REDVAULT payment', () => {
    const input = makeInput();
    input.availability = { redvaultAvailable: true };
    expect(
      deriveCheckoutScreenModel(input).steps.payment.redvaultAvailable
    ).toBe(true);
  });

  it('still hides REDVAULT when the payment method is unavailable', () => {
    const input = makeInput();
    input.availability = { redvaultAvailable: false };
    expect(
      deriveCheckoutScreenModel(input).steps.payment.redvaultAvailable
    ).toBe(false);
  });

  it('projects fresh form, delivery, payment and action identities into the screen', () => {
    const model = deriveCheckoutScreenModel(makeInput());

    expect(model.steps.contact.values).toEqual({
      firstName: 'Ada',
      lastName: 'Okon',
      customerEmail: 'ada@example.test',
      customerPhone: '+2348031234567',
    });
    expect(model.steps.delivery.address).toMatchObject({
      street: '12 Broad Street',
      city: 'Lagos Island',
      state: 'Lagos',
      merchantCountry: 'NG',
      isHydrated: true,
    });
    expect(model.steps.payment.session).toBe(paymentSession);
    expect(model.steps.payment.handlePlaceOrder).toBe(handlePlaceOrder);
    expect(model.steps.payment.setNewsletterOptIn).toBe(setNewsletterOptIn);
    expect(model.page.onReturnToCart).toBe(onReturnToCart);
    expect(model.overlays.dva.onConfirmTransfer).toBe(onConfirmTransfer);
    expect(model.summary.presentation.discount).toMatchObject({
      visible: true,
      merchantId: 'merchant-1',
      cartTotal: 100_000,
      productIds: ['product-1'],
    });
  });

  it('keeps resumed order totals authoritative and hides its local discount input', () => {
    const resumedOrder: ResumedOrder = {
      id: 'order-resume-1',
      short_id: 'BACI-RESUME-1',
      subtotal: 200_000,
      shipping_cost: 0,
      total: 215_000,
      tax_amount: 15_000,
      customer_name: 'Ada Okon',
      customer_email: 'ada@example.test',
      customer_phone: '+2348031234567',
      shipping_address: {
        address: '12 Broad Street',
        city: 'Lagos Island',
        state: 'Lagos',
        phone: '+2348031234567',
      },
      items: [],
    };
    const resumed = makeInput({
      resumedOrder,
      hasCheckoutCartItems: false,
    });
    const model = deriveCheckoutScreenModel(resumed);

    expect(model.summary.payment).toBe(paymentSession);
    expect(model.summary.presentation.mobile).toMatchObject({
      cartTotal: 200_000,
      taxAmount: 15_000,
      deliveryCost: 0,
    });
    expect(model.summary.presentation.discount.visible).toBe(false);
    expect(model.summary.presentation.discount.cartTotal).toBe(215_000);

    // Only an existing order with a selected direct gateway and no active cart
    // may proceed without a newly validated delivery destination.
    resumed.sessions.delivery.validation.isValid = false;
    resumed.sessions.attempt.preferredGateway = 'credpal';
    const cart = resumed.display.checkoutCart;
    resumed.display.checkoutCart = [];
    const directPayment = deriveCheckoutScreenModel(resumed);
    expect(directPayment.steps.payment.isDeliveryValid).toBe(true);
    expect(directPayment.summary.presentation.desktop.isDeliveryValid).toBe(
      true
    );
    resumed.display.checkoutCart = cart;
    const freshOrder = deriveCheckoutScreenModel(resumed);
    expect(freshOrder.steps.payment.isDeliveryValid).toBe(false);
    expect(freshOrder.summary.presentation.desktop.isDeliveryValid).toBe(false);
    resumed.display.checkoutCart = [];
    resumed.sessions.attempt.preferredGateway = null;
    expect(
      deriveCheckoutScreenModel(resumed).steps.payment.isDeliveryValid
    ).toBe(false);
  });

  it('preserves wallet amount and selection callback identities', () => {
    const model = deriveCheckoutScreenModel(makeInput());

    expect(model.summary.presentation.desktop).toMatchObject({
      walletBalance: 2_500,
      remainingAmount: 107_500,
      payWithWallet: false,
    });
    expect(model.summary.presentation.desktop.setPayWithWallet).toBe(
      setPayWithWallet
    );
    expect(model.summary.payment.total).toBe(107_500);
  });

  it('keeps a completed shared-cart UBA review actionable without a new empty-cart delivery quote', () => {
    const input = makeInput();
    const fingerprint = `uba_redvault:${JSON.stringify({
      merchantId: 'merchant-1',
      customerEmail: 'ada@example.test',
      items: [{ product_id: 'product-1' }],
    })}`;
    const ready = {
      orderId: 'order-1',
      trackingToken: 'tracking-proof',
      customerEmail: 'ada@example.test',
      customerName: 'Ada Okon',
      customerPhone: '+2348031234567',
      checkoutFingerprint: fingerprint,
      billingAddress: { line1: 'Store', city: 'Lagos', country: 'NG' },
      currency: 'NGN',
      total: 102.5,
    };
    const pending = {
      orderId: ready.orderId,
      trackingToken: ready.trackingToken,
      merchantId: 'merchant-1',
      customerEmail: ready.customerEmail,
      customerPhone: ready.customerPhone,
      checkoutFingerprint: fingerprint,
      paymentMethod: 'uba_redvault',
      amountDueToGateway: 102.5,
      createdAt: '2026-10-29T00:00:00.000Z',
      redvaultReview: {
        ready,
        summary: {
          productSubtotalKobo: 10_000,
          eligibleSubtotalKobo: 10_000,
          ineligibleSubtotalKobo: 0,
          discountKobo: 500,
          assuranceFeeKobo: 0,
          taxKobo: 750,
          shippingKobo: 0,
          giftWrappingKobo: 0,
          payableKobo: 10_250,
          mixedBasket: false,
        },
      },
    };
    input.display.checkoutCart = [];
    input.display.sharedCartEnabled = true;
    input.display.sharedCartRef = null;
    input.sessions.delivery.validation.isValid = false;
    input.sessions.attempt.pendingCheckoutOrder = pending;
    input.sessions.financial.paymentSession = {
      ...paymentSession,
      method: 'uba_redvault',
      redvault: { ...paymentSession.redvault, orderReady: ready },
    };

    const model = deriveCheckoutScreenModel(input);
    expect(model.steps.payment.isDeliveryValid).toBe(true);
    expect(model.summary.presentation.desktop.isDeliveryValid).toBe(true);
    expect(model.steps.delivery.session.validation.isValid).toBe(true);

    input.sessions.attempt.pendingCheckoutOrder = {
      ...pending,
      trackingToken: 'different-proof',
    };
    expect(deriveCheckoutScreenModel(input).steps.payment.isDeliveryValid).toBe(
      false
    );
    expect(
      deriveCheckoutScreenModel(input).steps.delivery.session.validation.isValid
    ).toBe(false);

    input.sessions.attempt.pendingCheckoutOrder = pending;
    input.display.sharedCartRef = { cartId: 'new-cart', version: 1 };
    expect(deriveCheckoutScreenModel(input).steps.payment.isDeliveryValid).toBe(
      false
    );
    input.display.sharedCartRef = null;
    input.display.sharedCartEnabled = false;
    expect(deriveCheckoutScreenModel(input).steps.payment.isDeliveryValid).toBe(
      false
    );
  });
});
