import { customerSavingsPlanFunding } from './customer-savings-plan-funding';
import { clearObservedPiggyvestPrimaryCapability } from './piggyvest-primary-capability-cache';

const mockFetchJson = jest.fn();
const mockBuildMerchantIdentifiers = jest.fn((input: unknown) => input);
const mockCreateApiClient = jest.fn((..._args: unknown[]) => ({
  fetchJson: mockFetchJson,
  buildMerchantIdentifiers: mockBuildMerchantIdentifiers,
}));
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: (...args: unknown[]) =>
    mockCreateApiClient(...args),
}));

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const GOAL = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  jest.clearAllMocks();
  clearObservedPiggyvestPrimaryCapability();
  mockFetchJson.mockResolvedValue({
    status: 'ready',
    goalId: GOAL,
    accounts: [
      {
        accountNumber: '0001234567',
        accountName: 'Synthetic account',
        bankName: 'Synthetic bank',
      },
    ],
  });
});

it('constructs a fresh API client per provisioning operation', async () => {
  await customerSavingsPlanFunding.provision({
    goalId: GOAL,
    merchantId: MERCHANT,
    bvn: '00000000000',
  });
  await customerSavingsPlanFunding.provision({
    goalId: GOAL,
    merchantId: MERCHANT,
    bvn: '00000000000',
  });
  // A module singleton would cache the first user's access token until
  // expiry, provisioning under the former customer after an account
  // switch; per-operation construction re-reads the session every time.
  expect(mockCreateApiClient).toHaveBeenCalledTimes(2);
});

it('constructs a fresh API client per recovery operation', async () => {
  await customerSavingsPlanFunding.recover({
    goalId: GOAL,
    merchantId: MERCHANT,
  });
  await customerSavingsPlanFunding.recover({
    goalId: GOAL,
    merchantId: MERCHANT,
  });
  expect(mockCreateApiClient).toHaveBeenCalledTimes(2);
});
