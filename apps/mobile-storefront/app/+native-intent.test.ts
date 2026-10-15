const mockCapture = jest.fn((_path: string, _config: unknown) => '/cart');

jest.mock('@/env', () => ({
  EXPO_PUBLIC_API_URL: 'https://api.usebaci.com',
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

import { redirectSystemPath } from './+native-intent';

describe('redirectSystemPath', () => {
  beforeEach(() => {
    mockCapture.mockClear();
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
      platformRootDomain: 'api.usebaci.com',
    });
  });
});
