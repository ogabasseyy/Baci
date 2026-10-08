import { beforeEach, expect, it, jest } from '@jest/globals';

const mockFetch = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('./customer-savings-api', () => ({
  getCustomerSavingsApiClient: () => ({ fetchJson: mockFetch }),
}));
const { fetchSavingsPlanFunding, fetchExistingSavingsPlanFunding } =
  require('./customer-savings') as typeof import('./customer-savings');
const input = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  goalId: '22222222-2222-4222-8222-222222222222',
};
beforeEach(() => {
  jest.clearAllMocks();
});

it('provisions an owned primary plan with explicit interest choice without resending BVN', async () => {
  mockFetch.mockResolvedValue({ goalId: input.goalId, status: 'pending' });
  await fetchSavingsPlanFunding({
    ...input,
    bvn: '00000000000',
    enableInterestAccrual: true,
  });
  expect(mockFetch).toHaveBeenCalledWith({
    path: '/api/storefront/customer/savings/primary-provisioning',
    method: 'POST',
    includeCsrf: true,
    signal: undefined,
    body: { ...input, consent: true, interestAccepted: true },
  });
});

it('checks primary setup without creating a wallet or resubmitting interest consent', async () => {
  mockFetch.mockResolvedValue({ goalId: input.goalId, status: 'pending' });
  await fetchExistingSavingsPlanFunding(input);
  expect(mockFetch).toHaveBeenCalledWith({
    path: '/api/storefront/customer/savings/primary-provisioning',
    method: 'PATCH',
    includeCsrf: true,
    signal: undefined,
    body: input,
  });
});

it('does not display another goal account returned by the server', async () => {
  mockFetch.mockResolvedValue({
    goalId: '33333333-3333-4333-8333-333333333333',
    status: 'pending',
  });
  await expect(fetchExistingSavingsPlanFunding(input)).rejects.toThrow();
});

it('shows a helpful error for a provider account conflict rather than a schema error', async () => {
  mockFetch.mockResolvedValue({
    goalId: input.goalId,
    status: 'conflict',
    accounts: [],
  });
  await expect(fetchExistingSavingsPlanFunding(input)).rejects.toThrow(
    'This plan account needs review. Please contact support before trying again.'
  );
});

it('shows setup guidance when no provisioning intent exists', async () => {
  mockFetch.mockResolvedValue({
    goalId: input.goalId,
    status: 'not_found',
    accounts: [],
  });
  await expect(fetchExistingSavingsPlanFunding(input)).rejects.toThrow(
    'This plan account has not been set up yet.'
  );
});
