import { expect, it } from '@jest/globals';
import { imeiAccountScope } from './imei-account-scope';

it('names the store, customer and signed-in user', () => {
  expect(
    imeiAccountScope({
      merchantId: 'm1',
      customer: { id: 'c1' },
      session: { user: { id: 'u1' } },
    })
  ).toBe('m1:c1:u1');
});

it('tells a signed-out screen apart from a signed-in one', () => {
  expect(imeiAccountScope({ merchantId: null, customer: null })).toBe(
    'undefined:undefined:'
  );
  expect(
    imeiAccountScope({ merchantId: 'm1', customer: { id: 'c1' } })
  ).not.toBe(
    imeiAccountScope({
      merchantId: 'm1',
      customer: { id: 'c1' },
      session: { user: { id: 'u1' } },
    })
  );
});
