import { describe, expect, it } from 'vitest';
import { currentCheckoutShippingRequestKey } from './checkout-shipping-current-request-key';

const pickup: Parameters<typeof currentCheckoutShippingRequestKey>[0] = {
  isHydrated: true,
  merchantId: 'merchant-1',
  merchantCountry: 'NG',
  checkoutCart: [{ name: 'Phone', price: 100, quantity: 1 }],
  checkoutCartCatalogSubtotal: 100,
  deliveryCoordinates: null,
  isNewAddressMode: true,
  newAddressStreet: '',
  newAddressCity: 'Ikeja',
  newAddressState: 'Lagos',
  addresses: [],
  selectedAddressId: 0,
  deliveryPreference: 'pickup_station',
};

describe('checkout quote request identity', () => {
  it('does not consider quotes current before hydration or merchant resolution', () => {
    expect(
      currentCheckoutShippingRequestKey({ ...pickup, isHydrated: false })
    ).toBe('');
    expect(
      currentCheckoutShippingRequestKey({ ...pickup, merchantId: undefined })
    ).toBe('');
  });

  it('identifies pickup by city and state without requiring a street address', () => {
    expect(JSON.parse(currentCheckoutShippingRequestKey(pickup))).toMatchObject(
      {
        address: 'ikeja, lagos',
        city: 'ikeja',
        state: 'lagos',
        deliveryPreference: 'pickup_station',
      }
    );
    expect(
      currentCheckoutShippingRequestKey({ ...pickup, newAddressCity: 'Yaba' })
    ).not.toBe(currentCheckoutShippingRequestKey(pickup));
  });

  it('invalidates the identity for a missing or changed saved address', () => {
    expect(
      currentCheckoutShippingRequestKey({ ...pickup, isNewAddressMode: false })
    ).toBe('');
    const saved = {
      ...pickup,
      isNewAddressMode: false,
      selectedAddressId: 17,
      addresses: [
        {
          id: 17,
          label: 'Home',
          address: '12 Allen Avenue, Ikeja, Lagos',
          phone: '+2348000000000',
          isDefault: true,
        },
      ],
    };
    expect(JSON.parse(currentCheckoutShippingRequestKey(saved))).toMatchObject({
      city: 'ikeja',
      state: 'lagos',
    });
    expect(
      currentCheckoutShippingRequestKey({
        ...saved,
        addresses: [
          { ...saved.addresses[0], address: '8 Sample Road, Yaba, Lagos' },
        ],
      })
    ).not.toBe(currentCheckoutShippingRequestKey(saved));
  });
});
