import { issueGoalAction } from './goal-lifecycle-api';

const mockFetchJson = jest.fn();
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-a' } }) },
}));

describe('server keeps PiggyVest off', () => {
  beforeEach(() => jest.clearAllMocks());

  it('surfaces a not-ready refusal with its code and makes exactly one call', async () => {
    mockFetchJson.mockRejectedValue(
      Object.assign(new Error('not ready'), { code: 'PIGGYVEST_NOT_READY' })
    );
    await expect(
      issueGoalAction('cancel', {
        merchantId: '11111111-1111-4111-8111-111111111111',
        goalId: '22222222-2222-4222-8222-222222222222',
      })
    ).rejects.toMatchObject({ code: 'PIGGYVEST_NOT_READY' });
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
  });
});
