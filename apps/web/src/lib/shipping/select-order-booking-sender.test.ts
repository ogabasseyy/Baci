import { describe, expect, it } from 'vitest';
import { selectOrderBookingSender } from './select-order-booking-sender';

const paidOrigin = {
  name: 'Former Contact',
  phone: '08000000001',
  address: 'Paid Pickup',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
  postalCode: '100001',
  latitude: 6.5,
  longitude: 3.3,
};
const current = {
  ...paidOrigin,
  name: 'Booking Contact',
  phone: '08000000002',
  address: 'Different Pickup',
  postalCode: '100002',
};

describe('selectOrderBookingSender', () => {
  it('uses the paid pickup and current validated contact for a partner order', () => {
    expect(selectOrderBookingSender('partner', current, paidOrigin)).toEqual({
      ...paidOrigin,
      name: current.name,
      phone: current.phone,
    });
  });

  it('rejects a missing pickup for a partner order', () => {
    expect(() =>
      selectOrderBookingSender('partner', current, undefined)
    ).toThrow('The paid partner quote is missing its pickup origin.');
  });

  it('keeps current sender behavior for ordinary orders', () => {
    expect(selectOrderBookingSender('online_store', current, paidOrigin)).toBe(
      current
    );
  });
});
