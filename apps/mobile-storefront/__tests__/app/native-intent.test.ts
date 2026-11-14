const mockCapture = jest.fn((_path: string, _config: unknown) => '/cart');
const mockEnv: { apiUrl: string; rootDomain?: string } = {
  apiUrl: 'https://api.usebaci.com',
  rootDomain: undefined,
};

jest.mock('@/env', () => ({
  get EXPO_PUBLIC_API_URL() {
    return mockEnv.apiUrl;
  },
  get EXPO_PUBLIC_ROOT_DOMAIN() {
    return mockEnv.rootDomain;
  },
}));

jest.mock('@/lib/config', () => ({
  CONFIG: {
    MERCHANT_ID: 'merchant-1',
    MERCHANT_SLUG: 'ogabassey',
    MERCHANT_DOMAIN: 'shop.example.com',
  },
}));

jest.mock('@/lib/cart/pairing-link', () => ({
  captureCartPairingLink: (path: string, config: unknown) =>
    mockCapture(path, config),
}));

import { redirectSystemPath } from '../../app/+native-intent';

describe('redirectSystemPath', () => {
  beforeEach(() => {
    mockCapture.mockClear();
    mockEnv.apiUrl = 'https://api.usebaci.com';
    mockEnv.rootDomain = undefined;
  });

  it.each([
    'ogabassey:///',
    'ogabassey://',
    'OGABASSEY:///',
    'ogabassey://?handoff=secret',
    'ogabassey://#handoff=secret',
    'ogabassey:///?handoff=secret',
    'ogabassey:///#handoff=secret',
  ])('keeps the initial custom-scheme launcher root %s on Home', (path) => {
    expect(redirectSystemPath({ path, initial: true })).toBe('/');
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it.each([
    'OGABASSEY:///',
    'Ogabassey://',
  ])('keeps mixed-case bare launcher roots on Home after launch: %s', (path) => {
    expect(redirectSystemPath({ path, initial: false })).toBe('/');
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('keeps bare launcher roots on Home and validates route URLs', () => {
    for (const value of [{ path: 'ogabassey:///cart', initial: true }]) {
      expect(redirectSystemPath(value)).toBe('/cart');
      expect(mockCapture).toHaveBeenLastCalledWith('/cart', expect.anything());
    }
    expect(redirectSystemPath({ path: 'ogabassey:///', initial: false })).toBe(
      '/'
    );
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it('preserves a route when only the custom URL scheme is uppercase', () => {
    expect(
      redirectSystemPath({ path: 'OGABASSEY:///cart', initial: true })
    ).toBe('/cart');
    expect(mockCapture).toHaveBeenCalledWith('/cart', expect.anything());
  });

  it.each([
    'ogabassey://cart',
    'ogabassey://cart/',
    'ogabassey:///cart',
    'ogabassey:///cart/',
    'OGABASSEY://CART/',
    'OGABASSEY:///cart/',
  ])('normalizes route-form custom URL %s', (path) => {
    expect(redirectSystemPath({ path, initial: true })).toBe('/cart');
    expect(mockCapture).toHaveBeenCalledWith('/cart', expect.anything());
  });

  it('normalizes a custom-scheme host into the storefront route path', () => {
    expect(
      redirectSystemPath({ path: 'ogabassey://cart', initial: true })
    ).toBe('/cart');
    expect(mockCapture).toHaveBeenCalledWith('/cart', expect.anything());
  });

  it('preserves a pairing fragment on a host-form cart route with a trailing slash', () => {
    const path = 'ogabassey://cart/#handoff=token&hid=handoff-id';
    expect(redirectSystemPath({ path, initial: true })).toBe('/cart');
    expect(mockCapture).toHaveBeenCalledWith(
      '/cart#handoff=token&hid=handoff-id',
      expect.anything()
    );
  });

  it('preserves pairing fragments on path-form cart routes', () => {
    const path = 'ogabassey:///cart/#handoff=token&hid=handoff-id';
    expect(redirectSystemPath({ path, initial: true })).toBe('/cart');
    expect(mockCapture).toHaveBeenCalledWith(
      '/cart#handoff=token&hid=handoff-id',
      expect.anything()
    );
  });

  it('rejects custom-scheme pairing routes with URL userinfo', () => {
    expect(
      redirectSystemPath({
        path: 'ogabassey://user:pass@cart/#handoff=secret',
        initial: true,
      })
    ).toBe('/');
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('delegates to pairing capture with the configured merchant and platform root', () => {
    const result = redirectSystemPath({
      path: '/cart/link#handoff=token',
      initial: true,
    });

    expect(result).toBe('/cart');
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith('/cart/link#handoff=token', {
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
      merchantDomain: 'shop.example.com',
      // The issuer mints <slug>.usebaci.com links; the API origin is
      // the api.* host of that root.
      platformRootDomain: 'usebaci.com',
    });
  });

  it('prefers the explicit root domain over derivation', () => {
    mockEnv.rootDomain = 'staging.usebaci.com';
    redirectSystemPath({ path: '/cart/link#handoff=token', initial: true });

    expect(mockCapture).toHaveBeenCalledWith(
      '/cart/link#handoff=token',
      expect.objectContaining({ platformRootDomain: 'staging.usebaci.com' })
    );
  });

  it('normalizes an uppercase trailing-dot explicit root domain', () => {
    mockEnv.rootDomain = '  USEBACI.COM. ';
    redirectSystemPath({ path: '/cart/link#handoff=token', initial: true });

    expect(mockCapture).toHaveBeenCalledWith(
      '/cart/link#handoff=token',
      expect.objectContaining({ platformRootDomain: 'usebaci.com' })
    );
  });

  it('fails closed for an explicit root that is not a bare hostname', () => {
    mockEnv.rootDomain = 'https://usebaci.com';
    redirectSystemPath({ path: '/cart/link#handoff=token', initial: true });

    expect(mockCapture).toHaveBeenCalledWith(
      '/cart/link#handoff=token',
      expect.objectContaining({ platformRootDomain: '' })
    );
  });

  it('strips a staging API prefix when no explicit root is configured', () => {
    mockEnv.apiUrl = 'https://api-staging.usebaci.com';
    redirectSystemPath({ path: '/cart/link#handoff=token', initial: true });

    expect(mockCapture).toHaveBeenCalledWith(
      '/cart/link#handoff=token',
      expect.objectContaining({ platformRootDomain: 'usebaci.com' })
    );
  });

  it('does not guess a root for non-standard API host shapes', () => {
    mockEnv.apiUrl = 'https://staging-api.usebaci.com';
    redirectSystemPath({ path: '/cart/link#handoff=token', initial: true });

    expect(mockCapture).toHaveBeenCalledWith(
      '/cart/link#handoff=token',
      expect.objectContaining({ platformRootDomain: '' })
    );
  });

  it('does not derive a platform root from a custom api.* merchant domain', () => {
    mockEnv.apiUrl = 'https://api.shop.example.com';
    redirectSystemPath({ path: '/cart/link#handoff=token', initial: true });

    expect(mockCapture).toHaveBeenCalledWith(
      '/cart/link#handoff=token',
      expect.objectContaining({ platformRootDomain: '' })
    );
  });

  it('uses the platform apex API host as its own root', () => {
    mockEnv.apiUrl = 'https://usebaci.com';
    redirectSystemPath({ path: '/cart/link#handoff=token', initial: true });

    expect(mockCapture).toHaveBeenCalledWith(
      '/cart/link#handoff=token',
      expect.objectContaining({ platformRootDomain: 'usebaci.com' })
    );
  });

  it('does not guess a root from an arbitrary bare API host', () => {
    mockEnv.apiUrl = 'https://shop.example.com';
    redirectSystemPath({ path: '/cart/link#handoff=token', initial: true });

    expect(mockCapture).toHaveBeenCalledWith(
      '/cart/link#handoff=token',
      expect.objectContaining({ platformRootDomain: '' })
    );
  });

  it('fails closed without throwing when EXPO_PUBLIC_API_URL is malformed', () => {
    mockEnv.apiUrl = 'not a url';
    redirectSystemPath({ path: '/cart/link#handoff=token', initial: true });

    expect(mockCapture).toHaveBeenCalledWith(
      '/cart/link#handoff=token',
      expect.objectContaining({ platformRootDomain: '' })
    );
  });
});
