import { describe, expect, it } from 'vitest';
import { checkoutDeliveryHint } from './checkout-delivery-hint';

const pickup = {
  deliveryMethod: 'pickup',
  isLoadingQuotes: false,
  isNewAddressMode: true,
  city: 'Ikeja',
  state: 'Lagos',
  addressReady: false,
  hasDeliveryOptions: false,
};

describe('checkout delivery guidance', () => {
  it('asks only for city and state when pickup is selected', () => {
    expect(checkoutDeliveryHint({ ...pickup, city: ' ' })).toMatch(
      /city and state/i
    );
    expect(checkoutDeliveryHint(pickup)).toMatch(/refresh pickup/i);
  });

  it('reports loading before asking for pickup details', () => {
    expect(
      checkoutDeliveryHint({ ...pickup, city: '', isLoadingQuotes: true })
    ).toMatch(/checking pickup/i);
  });

  it('still asks for a complete street address for home delivery', () => {
    expect(checkoutDeliveryHint({ ...pickup, deliveryMethod: 'door' })).toMatch(
      /street address, city and state/i
    );
  });
});
