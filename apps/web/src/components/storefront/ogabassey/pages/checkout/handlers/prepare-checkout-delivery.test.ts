import { describe, expect, it } from 'vitest';
import type { ShippingQuote } from '@/types/shipping-quote';
import { prepareCheckoutDelivery } from './prepare-checkout-delivery';

const quote: ShippingQuote = {
  id: 'carrier-1',
  provider: 'GIGL',
  serviceTier: 'standard',
  carrierName: 'GIGL',
  displayName: 'GIGL Standard',
  estimatedDays: 2,
  price: 1500,
  currency: 'NGN',
  pickupIncluded: false,
  insuranceIncluded: false,
};

const baseInput = {
  method: 'door' as const,
  selectedQuoteId: 'carrier-1',
  selectedQuoteMatchesMethod: true,
  airportRequiresQuote: false,
  quotes: [quote],
  selectedAddress: undefined,
  isNewAddressMode: true,
  newAddressStreet: '12 Broad Street',
  newAddressCity: 'Lagos Island',
  newAddressState: 'Lagos',
  airportType: 'delivery' as const,
  customerPhone: '',
  merchantCountry: 'NG',
};

describe('prepareCheckoutDelivery', () => {
  it('prepares a new door address and carrier quote', () => {
    expect(prepareCheckoutDelivery(baseInput)).toMatchObject({
      address: {
        address: '12 Broad Street',
        city: 'Lagos Island',
        state: 'Lagos',
        countryCode: 'NG',
        country: 'Nigeria',
      },
      provider: 'GIGL',
      merchantRateId: null,
      issue: null,
    });
  });

  it('parses a saved door address and uses its phone when checkout has none', () => {
    const result = prepareCheckoutDelivery({
      ...baseInput,
      isNewAddressMode: false,
      selectedAddress: {
        id: 1,
        label: 'Home',
        address: '12 Broad Street, Lagos Island, Lagos',
        phone: '08012345678',
        isDefault: true,
      },
    });

    expect(result.address).toMatchObject({
      address: '12 Broad Street, Lagos Island, Lagos',
      city: 'Lagos Island',
      state: 'Lagos',
      phone: '08012345678',
    });
  });

  it('marks incomplete new door addresses before an order can be built', () => {
    expect(
      prepareCheckoutDelivery({ ...baseInput, newAddressState: '' }).issue
    ).toBe('incomplete-address');
  });

  it('rejects a dangling selected quote instead of inventing a provider', () => {
    const result = prepareCheckoutDelivery({
      ...baseInput,
      selectedQuoteId: 'expired-quote',
    });

    expect(result.issue).toBe('expired');
    expect(result.provider).toBeNull();
  });

  it('requires a quote for door delivery and does not require one for store pickup', () => {
    expect(
      prepareCheckoutDelivery({ ...baseInput, selectedQuoteId: '' }).issue
    ).toBe('required');

    expect(
      prepareCheckoutDelivery({
        ...baseInput,
        method: 'pickup',
        selectedQuoteId: 'stale-merchant-rate',
      })
    ).toMatchObject({
      address: { address: 'Pickup at Store', city: 'Lagos', state: 'Lagos' },
      merchantRateId: null,
      provider: null,
      issue: null,
    });
  });

  it('sends merchant rates through the server-priced null-provider path', () => {
    const result = prepareCheckoutDelivery({
      ...baseInput,
      selectedQuoteId: 'mrate_rate-uuid',
      quotes: [{ ...quote, id: 'mrate_rate-uuid' }],
    });

    expect(result).toMatchObject({
      merchantRateId: 'rate-uuid',
      provider: null,
      issue: null,
    });
  });

  it('requires a matching quote only for airports configured to use one', () => {
    const result = prepareCheckoutDelivery({
      ...baseInput,
      method: 'airport',
      selectedQuoteId: '',
      selectedQuoteMatchesMethod: false,
      airportRequiresQuote: true,
    });

    expect(result.issue).toBe('required');
    expect(result.provider).toBeNull();
  });
});
