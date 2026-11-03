import { fetchWalletPinStatus } from './wallet-pin-api';

const mockFetchJson = jest.fn();
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-a' } }) },
}));

// With PiggyVest off the status route says "not primary, not available";
// reading it never mutates anything.
describe('server keeps PiggyVest off', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the off answer untouched and makes one read-only call', async () => {
    const off = {
      primary: false,
      hasPin: false,
      resetRequired: false,
      available: false,
    };
    mockFetchJson.mockResolvedValue(off);
    await expect(fetchWalletPinStatus()).resolves.toEqual(off);
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
    expect(mockFetchJson.mock.calls[0]?.[0]).not.toHaveProperty('method');
    expect(mockFetchJson.mock.calls[0]?.[0]).not.toHaveProperty('body');
  });

  it('surfaces a not-ready failure instead of inventing an answer', async () => {
    mockFetchJson.mockRejectedValue(
      Object.assign(new Error('not ready'), { code: 'PIGGYVEST_NOT_READY' })
    );
    await expect(fetchWalletPinStatus()).rejects.toThrow('not ready');
  });
});
