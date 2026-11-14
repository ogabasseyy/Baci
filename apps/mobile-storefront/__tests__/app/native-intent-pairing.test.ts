import {
  clearCartPairingLink,
  peekCartPairingLink,
} from '@/lib/cart/pairing-link';

jest.mock('@/env', () => ({
  EXPO_PUBLIC_API_URL: 'https://api.usebaci.com',
  EXPO_PUBLIC_ROOT_DOMAIN: undefined,
}));

jest.mock('@/lib/config', () => ({
  CONFIG: {
    MERCHANT_ID: '11111111-1111-4111-8111-111111111111',
    MERCHANT_SLUG: 'alpha',
    MERCHANT_DOMAIN: 'shop.example.com',
  },
}));

import { redirectSystemPath } from '../../app/+native-intent';

const merchantId = '11111111-1111-4111-8111-111111111111';
const handoffId = '22222222-2222-4222-8222-222222222222';
const token = `ch1.${Buffer.from(
  JSON.stringify({
    merchantId,
    destination: { type: 'native', app: 'storefront' },
  })
).toString('base64url')}.signature`;

afterEach(() => clearCartPairingLink());

it.each([
  'ogabassey://cart',
  'ogabassey://cart/',
  'ogabassey:///cart',
  'ogabassey:///cart/',
  'OGABASSEY://CART/',
  'OGABASSEY:///cart/',
])('captures a valid fragment pairing from custom-scheme form %s', (url) => {
  expect(
    redirectSystemPath({
      path: `${url}#handoff=${token}&hid=${handoffId}`,
      initial: true,
    })
  ).toBe('/cart');
  expect(peekCartPairingLink()).toMatchObject({ token, handoffId, merchantId });
});

it.each([
  ['malformed handoff token', 'handoff=ch1.invalid.signature'],
  ['duplicate pairing fragment key', `handoff=${token}&handoff=${token}`],
])('does not capture a %s from a path-form custom URL', (_label, fragment) => {
  expect(
    redirectSystemPath({
      path: `ogabassey:///cart/#${fragment}&hid=${handoffId}`,
      initial: true,
    })
  ).toBe('/cart');
  expect(peekCartPairingLink()).toBeNull();
});

it('does not accept pairing secrets in the URL query', () => {
  expect(
    redirectSystemPath({
      path: `ogabassey:///cart?handoff=${token}&hid=${handoffId}`,
      initial: true,
    })
  ).toBe('/cart');
  expect(peekCartPairingLink()).toBeNull();
});
