import { describe, expect, it } from 'vitest';
import type { ChatwootCheckoutDeliveryResult } from './chatwoot-checkout-delivery';
import { buildChatwootCheckoutOrderRequest } from './chatwoot-checkout-order-request';
import {
  checkoutDisplayCart,
  checkoutPlaceRequest,
  checkoutReview,
  merchantQuote,
} from './chatwoot-checkout-test-fixtures';

const delivery = {
  ok: true,
  method: 'door',
  quote: merchantQuote(),
  merchantRateId: 'rate-1',
  address: {
    address: '12 Admiralty Way',
    city: 'Lekki',
    state: 'Lagos',
    phone: '+2348012345678',
    countryCode: 'NG',
    country: 'Nigeria',
  },
} as unknown as Extract<ChatwootCheckoutDeliveryResult, { ok: true }>;

const build = (taxRate: number) =>
  buildChatwootCheckoutOrderRequest(
    {
      review: checkoutReview,
      display: checkoutDisplayCart,
      delivery,
      customer: checkoutPlaceRequest.customer,
      taxRate,
    },
    checkoutDisplayCart
  );

describe('buildChatwootCheckoutOrderRequest', () => {
  it('builds a bank-transfer order bound to the reviewed shared cart', () => {
    expect(build(0.075)).toMatchObject({
      merchant_id: 'merchant-1',
      payment_method: 'bank_transfer',
      delivery_method: 'door',
      shipping_rate_id: 'rate-1',
      shipping_provider: null,
      selected_quote_id: null,
      subtotal: 2000,
      shipping_fee: 2500,
      tax_amount: 150,
      expected_total: 4650,
      use_wallet_credit: false,
      wallet_amount: 0,
      gift_wrapping_fee: 0,
      shared_cart: {
        cart_id: 'cart-1',
        checkout_session_id: 'session-1',
        checkout_generation: 3,
        cart_version: 8,
      },
    });
  });

  it('adds no tax for an unregistered merchant', () => {
    expect(build(0)).toMatchObject({ tax_amount: 0, expected_total: 4500 });
  });
});
