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

  it('uses a bare root API host as the root itself', () => {
    mockEnv.apiUrl = 'https://usebaci.com';
    redirectSystemPath({ path: '/cart/link#handoff=token', initial: true });

    expect(mockCapture).toHaveBeenCalledWith(
      '/cart/link#handoff=token',
      expect.objectContaining({ platformRootDomain: 'usebaci.com' })
    );
  });
});
