import { beforeEach, expect, it, jest } from '@jest/globals';

const mockFetchJson = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
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
it('posts integer kobo and the existing operation key with CSRF', async () => {
  mockFetchJson.mockResolvedValue({
    status: 'pending',
    operationId: input.idempotencyKey,
  });
  expect(await addPiggyvestPrimarySavingsContribution(input)).toEqual({
    status: 'pending',
    operationId: input.idempotencyKey,
  });
  expect(mockFetchJson).toHaveBeenCalledWith({
    path: '/api/storefront/customer/savings/primary-transfer',
    method: 'POST',
    includeCsrf: true,
    body: {
      merchantId: input.merchantId,
      goalId: input.goalId,
      operationId: input.idempotencyKey,
      amountKobo: 2000,
    },
  });
});
it('does not accept a response for another operation', async () => {
  mockFetchJson.mockResolvedValue({
    status: 'confirmed',
    operationId: input.goalId,
  });
  await expect(addPiggyvestPrimarySavingsContribution(input)).rejects.toThrow(
    'could not be confirmed'
  );
});
it('rejects fractions smaller than kobo before requesting a payment', async () => {
  await expect(
    addPiggyvestPrimarySavingsContribution({ ...input, amount: 0.001 })
  ).rejects.toThrow();
  expect(mockFetchJson).not.toHaveBeenCalled();
});
