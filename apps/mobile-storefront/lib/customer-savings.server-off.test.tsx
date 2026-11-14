import {
  SERVER_OFF_GOAL_ID,
  SERVER_OFF_MERCHANT_ID,
} from '@/test-support/piggyvest-server-off.test-support';
import { setupExistingSavingsGoal } from './customer-savings';

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

beforeEach(() => jest.clearAllMocks());

// Existing-goal setup exists only on the primary rail: while the server keeps
// PiggyVest off there is no legacy equivalent, so nothing may be sent.
describe('server keeps PiggyVest off', () => {
  it('refuses to set a goal up and sends no request on a negative verdict', async () => {
    mockProbe.mockResolvedValue(false);
    await expect(
      setupExistingSavingsGoal({
        goalId: SERVER_OFF_GOAL_ID,
        merchantId: SERVER_OFF_MERCHANT_ID,
        interestAccepted: true,
      })
    ).rejects.toThrow('Setup is not available');
    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it('refuses without a merchant identity and never probes', async () => {
    await expect(
      setupExistingSavingsGoal({
        goalId: SERVER_OFF_GOAL_ID,
        interestAccepted: false,
      })
    ).rejects.toThrow('Setup is not available');
    expect(mockProbe).not.toHaveBeenCalled();
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});
