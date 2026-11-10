import { extractExpoPathFromURL } from 'expo-router/build/fork/extractPathFromURL';
import { captureCartPairingLink } from './pairing-link';

/**
 * captureCartPairingLink hands non-pairing deliveries back to Expo
 * Router unchanged. That is safe only while the router reduces every
 * delivery to an in-app path. This pins that behaviour against the
 * installed router, so an upgrade that changes it fails here.
 *
 * The import is a build-internal path on purpose: Expo Router exposes
 * no public function for this step. If an upgrade moves the file and
 * this import breaks, do not delete the test: point it at the
 * router's new URL-to-path function and re-confirm the assertions.
 */
const config = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  merchantSlug: 'alpha',
  merchantDomain: 'shop.example.com',
  platformRootDomain: 'usebaci.com',
};

function routedPath(delivery: string): string {
  return extractExpoPathFromURL([], captureCartPairingLink(delivery, config));
}

it('routes a home-screen launch to the start screen', () => {
  expect(routedPath('ogabassey:///')).toBe('');
  expect(routedPath('ogabassey://')).toBe('');
});

it('routes own-scheme and universal links to their in-app path', () => {
  expect(routedPath('ogabassey://product/phone?color=blue')).toBe(
    'product/phone?color=blue'
  );
  expect(routedPath('https://shop.example.com/product/phone')).toBe(
    'product/phone'
  );
});

it('reduces foreign deliveries to a path with no scheme or host', () => {
  for (const delivery of [
    'https://evil.example/phish',
    '//evil.example/phish',
    'baci://evil.example/phish',
    'intent://evil.example/#Intent;scheme=https;end',
  ]) {
    const path = routedPath(delivery);
    expect(path).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
    expect(path).not.toMatch(/^\/\//);
    expect(path).not.toContain('://');
  }
  expect(routedPath('https://evil.example/phish')).toBe('phish');
});
