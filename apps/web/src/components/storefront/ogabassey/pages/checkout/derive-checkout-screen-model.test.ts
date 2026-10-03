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
});
