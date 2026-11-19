import {
  PRIMARY_STATUS_PATH,
  SERVER_OFF_GOAL_ID,
  SERVER_OFF_MERCHANT_ID,
  serverOffError,
} from '@/test-support/piggyvest-server-off.test-support';
import { customerSavingsPlanFunding } from './customer-savings-plan-funding';

const mockFetchJson = jest.fn();
const mockProbe = jest.fn();
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({
    fetchJson: mockFetchJson,
    buildMerchantIdentifiers: () => ({}),
  }),
}));
jest.mock('./piggyvest-primary-capability', () => ({
  ...jest.requireActual('./piggyvest-primary-capability'),
  getPiggyvestPrimaryCapability: (merchantId: string) => mockProbe(merchantId),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-a' } }) },
}));

const legacyPaths = () =>
  mockFetchJson.mock.calls.map((call) => (call[0] as { path: string }).path);

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchJson.mockResolvedValue({ status: 'pending' });
});

// The server keeping PiggyVest off: a negative verdict or a not-ready answer
// sends plan funding down the legacy endpoint, as in today's production build.
describe('server keeps PiggyVest off', () => {
  const selection = {
    goalId: SERVER_OFF_GOAL_ID,
    merchantId: SERVER_OFF_MERCHANT_ID,
  };

  it('reads status from the legacy endpoint on a negative verdict', async () => {
    mockProbe.mockResolvedValue(false);
    await customerSavingsPlanFunding.recover(selection);
    expect(legacyPaths()).toEqual(['/api/storefront/customer/savings/funding']);
    expect(legacyPaths()).not.toContain(PRIMARY_STATUS_PATH);
  });

  it('uses legacy provisioning for a merchant with no identity', async () => {
    await customerSavingsPlanFunding.provision({
      goalId: SERVER_OFF_GOAL_ID,
      bvn: '00000000000',
    });
    expect(mockProbe).not.toHaveBeenCalled();
    expect(legacyPaths()).toEqual(['/api/storefront/customer/savings/funding']);
  });

  it('falls back to legacy once the primary endpoint answers not ready', async () => {
    mockProbe.mockResolvedValue(true);
    mockFetchJson.mockRejectedValueOnce(serverOffError());
    await customerSavingsPlanFunding.recover(selection);
    expect(legacyPaths()).toEqual([
      PRIMARY_STATUS_PATH,
      '/api/storefront/customer/savings/funding',
    ]);
  });

  it('rejects instead of guessing when the probe itself fails', async () => {
    mockProbe.mockRejectedValue(new Error('network'));
    await expect(customerSavingsPlanFunding.recover(selection)).rejects.toThrow(
      'network'
    );
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});
