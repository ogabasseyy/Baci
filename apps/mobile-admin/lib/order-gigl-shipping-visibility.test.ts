import { describe, expect, it } from 'vitest';
import { getOrderGiglShippingVisibility } from './order-gigl-shipping-visibility';

describe('getOrderGiglShippingVisibility', () => {
  it('shows GIGL wallet actions only to the merchant owner', () => {
    expect(
      getOrderGiglShippingVisibility({
        merchantOwnerId: 'owner-1',
        userId: 'owner-1',
      }).isMerchantOwner
    ).toBe(true);
    expect(
      getOrderGiglShippingVisibility({
        merchantOwnerId: 'owner-1',
        userId: 'staff-1',
      }).isMerchantOwner
    ).toBe(false);
  });

  it('keeps a saved merchant-wallet GIGL quote bookable for the owner', () => {
    const visibility = getOrderGiglShippingVisibility({
      merchantOwnerId: 'owner-1',
      order: {
        selected_quote_id: 'quote-1',
        shipping_funding_source: 'merchant_wallet',
        shipping_provider: 'GIGL',
      },
      userId: 'owner-1',
    });

    expect(visibility.isSavedMerchantWalletGiglOrder).toBe(true);
    expect(visibility.providerBookingAvailable).toBe(true);
  });

  it('bugfix: hides staff booking for merchant-wallet GIGL without a recoverable charge', () => {
    const visibility = getOrderGiglShippingVisibility({
      merchantOwnerId: 'owner-1',
      order: {
        selected_quote_id: 'quote-1',
        shipping_funding_source: 'merchant_wallet',
        shipping_provider: 'GIGL',
      },
      userId: 'staff-1',
    });

    expect(visibility.isSavedMerchantWalletGiglOrder).toBe(true);
    expect(visibility.providerBookingAvailable).toBe(false);
  });

  it('allows staff booking only when a recoverable wallet charge already exists', () => {
    const visibility = getOrderGiglShippingVisibility({
      hasRecoverableWalletCharge: true,
      merchantOwnerId: 'owner-1',
      order: {
        selected_quote_id: 'quote-1',
        shipping_funding_source: 'merchant_wallet',
        shipping_provider: 'GIGL',
      },
      userId: 'staff-1',
    });

    expect(visibility.providerBookingAvailable).toBe(true);
  });

  it('only enables direct provider booking for an unbooked selected quote', () => {
    expect(
      getOrderGiglShippingVisibility({
        order: {
          payment_method: 'paystack',
          payment_status: 'paid',
          selected_quote_id: 'quote-1',
          shipping_provider: 'GIGL',
          shipment_id: null,
          tracking_number: null,
        },
      }).providerBookingAvailable
    ).toBe(true);

    expect(
      getOrderGiglShippingVisibility({
        order: {
          selected_quote_id: 'quote-1',
          shipping_provider: 'GIGL',
          shipment_id: 'shipment-1',
          tracking_number: null,
        },
      }).providerBookingAvailable
    ).toBe(false);
  });
  describe('bugfix: saved GIG quote on an order the server refuses to book directly', () => {
    const base = {
      selected_quote_id: 'quote-1',
      shipment_id: null,
      shipping_funding_source: null,
      shipping_provider: 'GIGL',
      tracking_number: null,
    };

    it.each([
      ['credit_direct', 'paid'],
      ['pod', 'pending'],
      ['pay_on_delivery', 'pending'],
      ['bank_transfer', 'paid'],
    ])('routes a null-funding %s order (%s) to the wallet panel', (payment_method, payment_status) => {
      const visibility = getOrderGiglShippingVisibility({
        merchantOwnerId: 'owner-1',
        order: { ...base, payment_method, payment_status },
        userId: 'owner-1',
      });

      expect(visibility.requiresWalletRebind).toBe(true);
      expect(visibility.providerBookingAvailable).toBe(false);
    });

    it('keeps direct booking for a paid null-funding order whose payment retained shipping', () => {
      const visibility = getOrderGiglShippingVisibility({
        merchantOwnerId: 'owner-1',
        order: { ...base, payment_method: 'paystack', payment_status: 'paid' },
        userId: 'owner-1',
      });

      expect(visibility.requiresWalletRebind).toBe(false);
      expect(visibility.providerBookingAvailable).toBe(true);
    });

    it('never rebinds a customer-checkout order', () => {
      const visibility = getOrderGiglShippingVisibility({
        merchantOwnerId: 'owner-1',
        order: {
          ...base,
          payment_method: 'credit_direct',
          payment_status: 'paid',
          shipping_funding_source: 'customer_checkout',
        },
        userId: 'owner-1',
      });

      expect(visibility.requiresWalletRebind).toBe(false);
      expect(visibility.providerBookingAvailable).toBe(true);
    });
  });
});
