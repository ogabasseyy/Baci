import {
  captureCartPairingLink,
  clearCartPairingLink,
  peekCartPairingLink,
} from './pairing-link';

const merchant = '11111111-1111-4111-8111-111111111111';
const hid = '22222222-2222-4222-8222-222222222222';
const config = {
  merchantId: merchant,
  merchantSlug: 'alpha',
  merchantDomain: 'shop.example.com',
};
const token = (changes: Record<string, unknown> = {}) =>
  `ch1.${Buffer.from(JSON.stringify({ merchantId: merchant, destination: { type: 'native', app: 'storefront' }, ...changes })).toString('base64url')}.signature`;
afterEach(() => clearCartPairingLink());
it('captures only trusted HTTPS handoffs and removes pairing fragments before routing', () => {
  const path = `https://shop.example.com/cart#handoff=${token()}&hid=${hid}`;
  expect(captureCartPairingLink(path, config)).toBe('/cart');
  expect(peekCartPairingLink()).toMatchObject({
    handoffId: hid,
    token: token(),
    destination: 'native',
  });
  clearCartPairingLink();
  expect(
    captureCartPairingLink(
      `https://alpha.usebaci.com/cart#handoff=${token()}&hid=${hid}`,
      config
    )
  ).toBe('/cart');
  expect(peekCartPairingLink()).not.toBeNull();
});
it('fails closed with an explicitly empty platform root', () => {
  const staging = { ...config, platformRootDomain: '' };
  expect(
    captureCartPairingLink(
      `https://alpha.usebaci.com/cart#handoff=${token()}&hid=${hid}`,
      staging
    )
  ).toBe('/cart');
  expect(peekCartPairingLink()).toBeNull();
  // The merchant custom domain remains allowed without a root.
  expect(
    captureCartPairingLink(
      `https://shop.example.com/cart#handoff=${token()}&hid=${hid}`,
      staging
    )
  ).toBe('/cart');
  expect(peekCartPairingLink()).not.toBeNull();
});
it('honours a configured non-default platform root domain', () => {
  const custom = { ...config, platformRootDomain: 'shops.example.net' };
  expect(
    captureCartPairingLink(
      `https://alpha.shops.example.net/cart#handoff=${token()}&hid=${hid}`,
      custom
    )
  ).toBe('/cart');
  expect(peekCartPairingLink()).not.toBeNull();
  clearCartPairingLink();
  expect(
    captureCartPairingLink(
      `https://alpha.usebaci.com/cart#handoff=${token()}&hid=${hid}`,
      custom
    )
  ).toBe('/cart');
  expect(peekCartPairingLink()).toBeNull();
});
it.each([
  'https://evil.example/cart',
  'http://shop.example.com/cart',
  'https://shop.example.com:444/cart',
  'https://shop.example.com/product/phone',
  'https://shop.example.com@evil.example/cart',
])('rejects untrusted pairing URLs without passing secrets to the router: %s', (prefix) => {
  const path = `${prefix}#handoff=${token()}&hid=${hid}`;
  expect(captureCartPairingLink(path, config)).toBe('/cart');
  expect(peekCartPairingLink()).toBeNull();
});
it('rejects tenant mismatch and duplicate or query-string secrets', () => {
  for (const path of [
    `https://shop.example.com/cart#handoff=${token({ merchantId: hid })}&hid=${hid}`,
    `https://shop.example.com/cart#handoff=${token({ destination: { type: 'web', app: 'storefront' } })}&hid=${hid}`,
    `https://shop.example.com/cart#handoff=${token()}&handoff=${token()}&hid=${hid}`,
    `https://shop.example.com/cart?handoff=${token()}&hid=${hid}`,
  ]) {
    expect(captureCartPairingLink(path, config)).toBe('/cart');
    expect(peekCartPairingLink()).toBeNull();
  }
});
it('preserves non-pairing navigation and identifies web-bound fallback without changing token authority', () => {
  expect(captureCartPairingLink('/product/phone?color=blue', config)).toBe(
    '/product/phone?color=blue'
  );
  const web = token({ destination: { type: 'web' } });
  captureCartPairingLink(
    `https://shop.example.com/cart#handoff=${web}&hid=${hid}`,
    config
  );
  expect(peekCartPairingLink()?.destination).toBe('web');
});
