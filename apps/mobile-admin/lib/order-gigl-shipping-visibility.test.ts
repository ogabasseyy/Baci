import { describe, expect, it } from 'vitest';
import { getOrderGiglShippingVisibility } from './order-gigl-shipping-visibility';

describe('getOrderGiglShippingVisibility', () => {
  const savedWalletOrder = {
    selected_quote_id: 'quote-1',
    shipping_funding_source: 'merchant_wallet',
    shipping_provider: 'GIGL',
  } as const;

  it('keeps a saved merchant-wallet GIGL quote bookable for anyone who can book GIG', () => {
    const visibility = getOrderGiglShippingVisibility({
      canBookGigl: true,
      order: savedWalletOrder,
    });

    expect(visibility.isSavedMerchantWalletGiglOrder).toBe(true);
    expect(visibility.providerBookingAvailable).toBe(true);
  });

  it('bugfix: hides booking for merchant-wallet GIGL from users who cannot book GIG', () => {
    const visibility = getOrderGiglShippingVisibility({
      canBookGigl: false,
      order: savedWalletOrder,
    });

    expect(visibility.isSavedMerchantWalletGiglOrder).toBe(true);
    expect(visibility.providerBookingAvailable).toBe(false);
  });

  it('defaults to no GIG booking rights when none are passed', () => {
    expect(
      getOrderGiglShippingVisibility({ order: savedWalletOrder })
        .providerBookingAvailable
    ).toBe(false);
  });

  it('allows booking without GIG rights only when a recoverable wallet charge already exists', () => {
    const visibility = getOrderGiglShippingVisibility({
      canBookGigl: false,
      hasRecoverableWalletCharge: true,
      order: savedWalletOrder,
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
