import { jest } from '@jest/globals';

jest.mock('@/lib/config', () => ({
  CONFIG: {
    MERCHANT_SLUG: 'ogabassey',
    ENABLE_SMART_CART_PRO: true,
  },
}));
jest.mock('@/hooks/useMerchantPaymentSettings', () => ({
  merchantPaymentSettingsQueryKey: ['test-payment-settings'],
}));

const mockGetQueryData = jest.fn();
jest.mock('@/lib/query-client', () => ({
  get queryClient() {
    return { getQueryData: mockGetQueryData };
  },
}));

describe('nativeAssurancePolicy', () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetQueryData.mockReset();
  });

  it('resolves the live shipping-insurance toggle from the query cache', async () => {
    mockGetQueryData.mockReturnValue({ shipping_insurance_enabled: true });
    const { nativeAssurancePolicy: policy } = await import(
      './cart-assurance-config'
    );
    expect(policy()).toEqual({
      smartCartProEnabled: true,
      merchantSlug: 'ogabassey',
      shippingInsuranceEnabled: true,
    });
    expect(mockGetQueryData).toHaveBeenCalledWith(['test-payment-settings']);
  });

  it('fails the setting to unknown when the cache read throws', async () => {
    mockGetQueryData.mockImplementation(() => {
      throw new Error('QueryClient is not a constructor');
    });
    const { nativeAssurancePolicy: policy } = await import(
      './cart-assurance-config'
    );
    expect(policy().shippingInsuranceEnabled).toBeUndefined();
  });

  it('fails the setting to unknown when the query client module is unloadable', async () => {
    jest.doMock('@/lib/query-client', () => {
      throw new Error('QueryClient is not a constructor');
    });
    const { nativeAssurancePolicy: policy } = await import(
      './cart-assurance-config'
    );
    expect(policy().shippingInsuranceEnabled).toBeUndefined();
  });
});
