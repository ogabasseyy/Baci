import { jest } from '@jest/globals';

jest.mock('@/lib/config', () => ({
  CONFIG: {
    MERCHANT_SLUG: 'ogabassey',
    ENABLE_SMART_CART_PRO: true,
  },
}));
jest.mock('@/hooks/useMerchantPaymentSettings', () => ({
  merchantPaymentSettingsQueryKey: ['test-payment-settings'],
  MERCHANT_PAYMENT_SETTINGS_STALE_MS: 5 * 60 * 1000,
}));

const mockGetQueryState = jest.fn();
const mockRefetchQueries = jest.fn<() => Promise<unknown[]>>();
jest.mock('@/lib/query-client', () => ({
  get queryClient() {
    return {
      getQueryState: mockGetQueryState,
      refetchQueries: mockRefetchQueries,
    };
  },
}));

describe('nativeAssurancePolicy', () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetQueryState.mockReset();
    mockRefetchQueries.mockReset();
    mockRefetchQueries.mockResolvedValue([]);
  });

  it('resolves the live shipping-insurance toggle from the query cache', async () => {
    // Lazily timestamped: the read happens after the module load, so the
    // value counts as network-fresh rather than restored.
    mockGetQueryState.mockImplementation(() => ({
      data: { shipping_insurance_enabled: true },
      dataUpdatedAt: Date.now(),
    }));
    const { nativeAssurancePolicy: policy } = await import(
      './cart-assurance-config'
    );
    expect(policy()).toEqual({
      smartCartProEnabled: true,
      merchantSlug: 'ogabassey',
      shippingInsuranceEnabled: true,
    });
    expect(mockGetQueryState).toHaveBeenCalledWith(['test-payment-settings']);
    expect(mockRefetchQueries).not.toHaveBeenCalled();
  });

  it('fails a fresh restore to unknown and kicks a refetch', async () => {
    // Persisted a minute ago (inside the stale window) but before this
    // session started: the merchant may have disabled the toggle since.
    mockGetQueryState.mockReturnValue({
      data: { shipping_insurance_enabled: true },
      dataUpdatedAt: Date.now() - 60 * 1000,
    });
    const { nativeAssurancePolicy: policy } = await import(
      './cart-assurance-config'
    );
    expect(policy().shippingInsuranceEnabled).toBeUndefined();
    expect(mockRefetchQueries).toHaveBeenCalledWith({
      queryKey: ['test-payment-settings'],
    });
  });

  it('fails a stale persisted restore to unknown so add-time defaults opt-out', async () => {
    mockGetQueryState.mockReturnValue({
      data: { shipping_insurance_enabled: true },
      dataUpdatedAt: Date.now() - 24 * 60 * 60 * 1000,
    });
    const { nativeAssurancePolicy: policy } = await import(
      './cart-assurance-config'
    );
    expect(policy().shippingInsuranceEnabled).toBeUndefined();
  });

  it('fails the setting to unknown when the cache read throws', async () => {
    mockGetQueryState.mockImplementation(() => {
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
