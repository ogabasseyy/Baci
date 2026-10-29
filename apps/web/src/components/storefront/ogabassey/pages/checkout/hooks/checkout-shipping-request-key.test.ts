import { expect, it } from 'vitest';
import { buildQuoteRequestKey as buildKey } from './checkout-shipping-request-key';

const receiver: Parameters<typeof buildKey>[0] = {
  address: '12 Sample Road',
  city: 'Ikeja',
  state: 'Lagos',
  deliveryPreference: 'door',
  merchantId: 'merchant-1',
  latitude: 6.6,
  longitude: 3.3,
  cartSubtotal: 1000,
  country: 'Nigeria',
  countryCode: 'NG',
};
const items = [{ name: 'Phone', quantity: 1, price: 1000 }];
const changedReceiver: Partial<typeof receiver>[] = [
  { address: '8 Sample Road' },
  { city: 'Ogombo' },
  { state: 'Ogun' },
  { deliveryPreference: 'pickup_station' },
  { merchantId: 'merchant-2' },
  { latitude: 6.7 },
  { longitude: 3.4 },
  { cartSubtotal: 2000 },
  { country: 'Ghana' },
  { countryCode: 'GH' },
];

it.each(
  changedReceiver
)('invalidates a resolved quote when its destination or eligibility changes: %j', (change) => {
  expect(buildKey({ ...receiver, ...change }, items)).not.toBe(
    buildKey(receiver, items)
  );
});

it.each([
  { name: 'Tablet' },
  { quantity: 2 },
  { price: 2000 },
  { negotiatedPrice: 0 },
])('invalidates quote economics when cart contents change: %j', (change) => {
  expect(
    buildKey(
      receiver,
      items.map((item) => ({ ...item, ...change }))
    )
  ).not.toBe(buildKey(receiver, items));
});

it('reuses equivalent address casing and whitespace', () => {
  expect(
    buildKey(
      {
        ...receiver,
        address: ' 12 SAMPLE ROAD ',
        city: ' IKEJA ',
        state: ' LAGOS ',
      },
      items
    )
  ).toBe(buildKey(receiver, items));
});

it('matches streetless pickup readiness to the locality sent by the loader', () => {
  const pickup = { ...receiver, deliveryPreference: 'pickup_station' as const };
  expect(buildKey({ ...pickup, address: ' ' }, items)).toBe(
    buildKey({ ...pickup, address: 'Ikeja, Lagos' }, items)
  );
});
