import { expect, it, jest } from '@jest/globals';

const mockFetchJson = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
}));
const { recoverPiggyvestPrimarySavings } =
  require('./piggyvest-primary-savings-recovery') as typeof import('./piggyvest-primary-savings-recovery');
const input = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  goalId: '22222222-2222-4222-8222-222222222222',
};
it('uses a read-only recovery request for the selected goal', async () => {
  mockFetchJson.mockResolvedValue({ operation: null });
  expect(await recoverPiggyvestPrimarySavings(input)).toBeNull();
  expect(mockFetchJson).toHaveBeenCalledWith({
    path: `/api/storefront/customer/savings/primary-transfer/pending?merchantId=${input.merchantId}&goalId=${input.goalId}`,
    method: 'GET',
  });
});
it('rejects a recovered operation belonging to a different goal', async () => {
  mockFetchJson.mockResolvedValue({
    operation: {
      operationId: input.goalId,
      goalId: input.merchantId,
      amountKobo: 100,
      state: 'dispatched',
    },
  });
  await expect(recoverPiggyvestPrimarySavings(input)).rejects.toThrow(
    'could not be recovered'
  );
});
it('blocks contributions when the pending lookup cannot reach durable state', async () => {
  mockFetchJson.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'SAVINGS_NOT_READY' })
  );
  await expect(recoverPiggyvestPrimarySavings(input)).rejects.toThrow(
    'unavailable'
  );
});
it('surfaces ambiguous recovery failures', async () => {
  mockFetchJson.mockRejectedValue(new Error('timeout'));
  await expect(recoverPiggyvestPrimarySavings(input)).rejects.toThrow(
    'timeout'
  );
});
