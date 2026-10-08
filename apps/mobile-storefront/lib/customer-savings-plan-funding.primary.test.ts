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
const mockProbe = jest.fn();
jest.mock('./piggyvest-primary-capability', () => {
  const actual = jest.requireActual('./piggyvest-primary-capability');
  return {
    ...actual,
    getPiggyvestPrimaryCapability: (...args: unknown[]) => mockProbe(...args),
  };
});

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
it('routes the pilot merchant to primary without probing', async () => {
  await customerSavingsPlanFunding.recover({
    goalId: GOAL,
    merchantId: MERCHANT,
  });
  expect(mockProbe).not.toHaveBeenCalled();
  expect(mockFetchJson).toHaveBeenCalledWith(
    expect.objectContaining({
      path: '/api/storefront/customer/savings/primary-provisioning',
    })
  );
});
it('probes an unobserved merchant and routes a positive verdict to primary', async () => {
  mockProbe.mockResolvedValue(true);
  await customerSavingsPlanFunding.provision({
    goalId: GOAL,
    merchantId: '11111111-1111-4111-8111-111111111111',
    bvn: '00000000000',
  });
  expect(mockProbe).toHaveBeenCalledWith(
    '11111111-1111-4111-8111-111111111111'
  );
  expect(mockFetchJson).toHaveBeenCalledTimes(1);
  expect(mockFetchJson).toHaveBeenCalledWith(
    expect.objectContaining({
      path: '/api/storefront/customer/savings/primary-provisioning',
    })
  );
});
it('falls back to legacy only on an authoritative negative probe', async () => {
  mockProbe.mockResolvedValue(false);
  await customerSavingsPlanFunding.provision({
    goalId: GOAL,
    merchantId: '11111111-1111-4111-8111-111111111111',
    bvn: '00000000000',
  });
  await customerSavingsPlanFunding.recover({
    goalId: GOAL,
    merchantId: '11111111-1111-4111-8111-111111111111',
  });
  expect(mockFetchJson).toHaveBeenCalledTimes(2);
  for (const call of mockFetchJson.mock.calls)
    expect(call[0]).toMatchObject({
      path: '/api/storefront/customer/savings/funding',
    });
});
it('rejects without legacy fallback when the probe is ambiguous', async () => {
  mockProbe.mockRejectedValue(new Error('network down'));
  await expect(
    customerSavingsPlanFunding.provision({
      goalId: GOAL,
      merchantId: '11111111-1111-4111-8111-111111111111',
      bvn: '00000000000',
    })
  ).rejects.toThrow('network down');
  await expect(
    customerSavingsPlanFunding.recover({
      goalId: GOAL,
      merchantId: '11111111-1111-4111-8111-111111111111',
    })
  ).rejects.toThrow('network down');
  expect(mockFetchJson).not.toHaveBeenCalled();
});
it('keeps the not-ready rollback after a positive probe', async () => {
  mockProbe.mockResolvedValue(true);
  mockFetchJson
    .mockRejectedValueOnce({ code: 'SAVINGS_NOT_READY' })
    .mockResolvedValue({
      status: 'ready',
      goalId: GOAL,
      accounts: [],
    });
  await customerSavingsPlanFunding.provision({
    goalId: GOAL,
    merchantId: '11111111-1111-4111-8111-111111111111',
    bvn: '00000000000',
  });
  expect(mockFetchJson).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      path: '/api/storefront/customer/savings/primary-provisioning',
    })
  );
  expect(mockFetchJson).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      path: '/api/storefront/customer/savings/funding',
    })
  );
});
