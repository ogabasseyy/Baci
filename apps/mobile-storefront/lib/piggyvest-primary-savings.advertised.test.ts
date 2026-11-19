import { beforeEach, expect, it, jest } from '@jest/globals';

const mockFetchJson = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockLegacyAdd = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRecover = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCreateClient = jest.fn((..._args: unknown[]) => ({
  fetchJson: mockFetchJson,
}));
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: (...args: unknown[]) =>
    mockCreateClient(...args),
}));
jest.mock('./customer-savings', () => ({
  addSavingsContribution: (...args: unknown[]) => mockLegacyAdd(...args),
}));
jest.mock('./piggyvest-primary-savings-recovery', () => ({
  recoverPiggyvestPrimarySavings: (...args: unknown[]) => mockRecover(...args),
}));
const mockAuthUserId: string | null = null;
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({
      user: mockAuthUserId ? { id: mockAuthUserId } : null,
    }),
  },
}));
const { addPiggyvestPrimarySavingsContribution } =
  require('./piggyvest-primary-savings') as typeof import('./piggyvest-primary-savings');
const input = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  goalId: '22222222-2222-4222-8222-222222222222',
  idempotencyKey: '33333333-3333-4333-8333-333333333333',
  amount: 20,
};
beforeEach(() => {
  jest.clearAllMocks();
});
it('never spends legacy funds when the screen advertised the PiggyVest balance', async () => {
  mockFetchJson.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'SAVINGS_NOT_READY' })
  );
  await expect(
    addPiggyvestPrimarySavingsContribution({
      ...input,
      primaryAdvertised: true,
    })
  ).rejects.toThrow(/isn't available yet/i);
  expect(mockRecover).not.toHaveBeenCalled();
  expect(mockLegacyAdd).not.toHaveBeenCalled();
});

it('still reports other primary refusals without touching legacy', async () => {
  mockFetchJson.mockRejectedValue(new Error('boom'));
  await expect(
    addPiggyvestPrimarySavingsContribution({
      ...input,
      primaryAdvertised: true,
    })
  ).rejects.toThrow('boom');
  expect(mockLegacyAdd).not.toHaveBeenCalled();
});
