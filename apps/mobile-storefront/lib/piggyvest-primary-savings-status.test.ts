import { expect, it, jest } from '@jest/globals';

const mockFetchJson = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
}));
const { checkPiggyvestPrimarySavingsStatus } =
  require('./piggyvest-primary-savings-status') as typeof import('./piggyvest-primary-savings-status');
it('uses a status-only PATCH with CSRF and checks the echoed operation', async () => {
  const input = {
    merchantId: '11111111-1111-4111-8111-111111111111',
    operationId: '22222222-2222-4222-8222-222222222222',
  };
  mockFetchJson.mockResolvedValue({
    operationId: input.operationId,
    status: 'pending',
  });
  expect(await checkPiggyvestPrimarySavingsStatus(input)).toEqual({
    operationId: input.operationId,
    status: 'pending',
  });
  expect(mockFetchJson).toHaveBeenCalledWith({
    path: '/api/storefront/customer/savings/primary-transfer',
    method: 'PATCH',
    includeCsrf: true,
    body: input,
  });
  mockFetchJson.mockResolvedValue({
    operationId: input.merchantId,
    status: 'confirmed',
  });
  await expect(checkPiggyvestPrimarySavingsStatus(input)).rejects.toThrow(
    'could not be confirmed'
  );
});
