import { customerSavingsPlanFunding } from './customer-savings-plan-funding';
import { clearObservedPiggyvestPrimaryCapability } from './piggyvest-primary-capability-cache';

const mockFetchJson = jest.fn();
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({
    fetchJson: mockFetchJson,
    buildMerchantIdentifiers: (input: unknown) => input,
  }),
}));
const mockProbe = jest.fn();
jest.mock('./piggyvest-primary-capability', () => ({
  ...jest.requireActual('./piggyvest-primary-capability'),
  getPiggyvestPrimaryCapability: (...args: unknown[]) => mockProbe(...args),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-a' } }) },
}));

// The pilot merchant routes to the primary rail without a probe.
const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const OTHER_MERCHANT = '11111111-1111-4111-8111-111111111111';
const GOAL = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  jest.clearAllMocks();
  clearObservedPiggyvestPrimaryCapability();
  mockFetchJson.mockResolvedValue({ status: 'pending', goalId: GOAL });
});

describe('customerSavingsPlanFunding.setup', () => {
  it.each([
    true,
    false,
  ])('posts the explicit choice (%s) to the setup endpoint under the initiating user', async (interestAccepted) => {
    await customerSavingsPlanFunding.setup({
      goalId: GOAL,
      merchantId: MERCHANT,
      interestAccepted,
    });
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/storefront/customer/savings/primary-provisioning/setup',
        method: 'POST',
        includeCsrf: true,
        expectedUserId: 'user-a',
        body: { merchantId: MERCHANT, goalId: GOAL, interestAccepted },
      })
    );
  });

  it('never sends a request without a boolean choice', async () => {
    await expect(
      customerSavingsPlanFunding.setup({
        goalId: GOAL,
        merchantId: MERCHANT,
        interestAccepted: undefined as unknown as boolean,
      })
    ).rejects.toThrow();
    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it('never falls back to the legacy rail', async () => {
    mockProbe.mockResolvedValue(false);
    await expect(
      customerSavingsPlanFunding.setup({
        goalId: GOAL,
        merchantId: OTHER_MERCHANT,
        interestAccepted: true,
      })
    ).rejects.toThrow('Setup is not available');
    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it('rejects an answer for a different goal', async () => {
    mockFetchJson.mockResolvedValue({
      status: 'pending',
      goalId: '44444444-4444-4444-8444-444444444444',
    });
    await expect(
      customerSavingsPlanFunding.setup({
        goalId: GOAL,
        merchantId: MERCHANT,
        interestAccepted: false,
      })
    ).rejects.toThrow();
  });
});

describe('customerSavingsPlanFunding.retrySetup', () => {
  it('posts to the setup endpoint with no interest answer, so the stored choice is reused', async () => {
    await customerSavingsPlanFunding.retrySetup({
      goalId: GOAL,
      merchantId: MERCHANT,
    });
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/storefront/customer/savings/primary-provisioning/setup',
        method: 'POST',
        includeCsrf: true,
        expectedUserId: 'user-a',
        body: { merchantId: MERCHANT, goalId: GOAL },
      })
    );
  });

  it('never falls back to the legacy rail', async () => {
    mockProbe.mockResolvedValue(false);
    await expect(
      customerSavingsPlanFunding.retrySetup({
        goalId: GOAL,
        merchantId: OTHER_MERCHANT,
      })
    ).rejects.toThrow('Setup is not available');
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});

describe('status read of an expired claim', () => {
  it('keeps the retryable flag the server sent on a pending answer', async () => {
    mockFetchJson.mockResolvedValue({
      status: 'pending',
      goalId: GOAL,
      setupRetryable: true,
    });
    const result = await customerSavingsPlanFunding.recover({
      goalId: GOAL,
      merchantId: MERCHANT,
    });
    expect(result).toMatchObject({ status: 'pending', setupRetryable: true });
  });
});
