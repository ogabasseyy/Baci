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
});
