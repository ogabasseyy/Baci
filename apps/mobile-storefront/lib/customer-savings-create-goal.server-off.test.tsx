import { SERVER_OFF_MERCHANT_ID } from '@/test-support/piggyvest-server-off.test-support';
import { createSavingsGoal } from './customer-savings-create-goal';

const mockFetchJson = jest.fn();
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({
    fetchJson: mockFetchJson,
    buildMerchantIdentifiers: ({ merchantId }: { merchantId?: string }) =>
      merchantId ? { merchantId } : {},
  }),
}));
// Only the request matters here; the response schema has its own tests.
jest.mock('@/schemas/customer-savings', () => ({
  SavingsGoalSummarySchema: { parse: (value: unknown) => value },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchJson.mockResolvedValue({ id: 'goal-1' });
});

// Goal creation has no PiggyVest-only branch on the client: with the server
// keeping PiggyVest off it sends the same legacy request, still pinned to the
// submitting account, and the server decides the rail.
describe('server keeps PiggyVest off', () => {
  it('creates the goal through the normal request, pinned to the submitter', async () => {
    await createSavingsGoal({
      contributionAmount: 20000,
      contributionFrequency: 'weekly',
      expectedUserId: 'user-a',
      maturityDate: '2026-12-29',
      merchantId: SERVER_OFF_MERCHANT_ID,
      nonWithdrawableAccepted: true,
      productId: 'product-1',
      sourceMode: 'manual',
      startDate: '2026-11-12',
      targetAmount: 250000,
      termsAccepted: true,
    });
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
    const request = mockFetchJson.mock.calls[0][0];
    expect(request).toMatchObject({
      expectedUserId: 'user-a',
      method: 'POST',
      path: '/api/storefront/customer/savings/goals',
    });
    expect(request.body).not.toHaveProperty('expectedUserId');
  });
});
