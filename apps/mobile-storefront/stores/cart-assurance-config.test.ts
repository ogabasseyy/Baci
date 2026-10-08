import { jest } from '@jest/globals';

const mockConfig: { merchantSlug: string; smartCartProEnabled: boolean } = {
  merchantSlug: 'ogabassey',
  smartCartProEnabled: true,
};
jest.mock('@/lib/config', () => ({
  CONFIG: {
    get MERCHANT_SLUG() {
      return mockConfig.merchantSlug;
    },
    get ENABLE_SMART_CART_PRO() {
      return mockConfig.smartCartProEnabled;
    },
  },
}));

import { nativeAssurancePolicy } from './cart-assurance-config';

describe('nativeAssurancePolicy', () => {
  beforeEach(() => {
    mockConfig.merchantSlug = 'ogabassey';
    mockConfig.smartCartProEnabled = true;
  });

  it('passes the native build configuration through', () => {
    expect(nativeAssurancePolicy()).toEqual({
      smartCartProEnabled: true,
      merchantSlug: 'ogabassey',
    });
  });

  it('reflects non-default builds', () => {
    mockConfig.merchantSlug = 'another-store';
    mockConfig.smartCartProEnabled = false;
    expect(nativeAssurancePolicy()).toEqual({
      smartCartProEnabled: false,
      merchantSlug: 'another-store',
    });
  });
});
