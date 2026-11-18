import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockFetchJson =
  jest.fn<(request: Record<string, unknown>) => Promise<unknown>>();
jest.mock('@/lib/customer-savings-api', () => ({
  getCustomerSavingsApiClient: () => ({
    buildMerchantIdentifiers: ({
      merchantId,
    }: {
      merchantId?: string | null;
    }) => (merchantId ? { merchantId } : {}),
    fetchJson: (request: Record<string, unknown>) => mockFetchJson(request),
  }),
}));
jest.mock('@/schemas/customer-savings', () => ({
  SavingsGoalSummarySchema: { parse: (value: unknown) => value },
}));

const { createSavingsGoal } =
  require('./customer-savings-create-goal') as typeof import('./customer-savings-create-goal');

const goal = {
  contributionAmount: 20000,
  contributionFrequency: 'daily',
  maturityDate: '2026-06-30',
  merchantId: 'merchant-1',
  nonWithdrawableAccepted: true,
  productId: 'product-1',
  sourceMode: 'manual',
  startDate: '2026-05-20',
  targetAmount: 800000,
  termsAccepted: true,
} as const;

describe('createSavingsGoal', () => {
  beforeEach(() => {
    mockFetchJson.mockReset();
    mockFetchJson.mockResolvedValue({ id: 'goal-1' });
  });

  it('pins the request to the submitting account without sending it in the body', async () => {
    await createSavingsGoal({ ...goal, expectedUserId: 'user-1' });
    const request = mockFetchJson.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      expectedUserId: 'user-1',
      method: 'POST',
      path: '/api/storefront/customer/savings/goals',
    });
    expect(request?.body).toMatchObject({ merchantId: 'merchant-1' });
    expect(request?.body).not.toHaveProperty('expectedUserId');
  });

  it('refuses to create the plan when the signed-in account changed', async () => {
    mockFetchJson.mockRejectedValue(new Error('Signed-in account changed'));
    await expect(
      createSavingsGoal({ ...goal, expectedUserId: 'user-1' })
    ).rejects.toThrow('Signed-in account changed');
  });
});
