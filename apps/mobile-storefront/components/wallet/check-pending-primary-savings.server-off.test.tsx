import { Alert } from 'react-native';
import { checkPendingPrimarySavings } from './check-pending-primary-savings';

jest.mock('@/lib/piggyvest-primary-savings-status', () => ({
  checkPiggyvestPrimarySavingsStatus: jest.fn(async () => {
    throw Object.assign(new Error('np'), {
      code: 'SAVINGS_MERCHANT_NOT_PRIMARY',
    });
  }),
}));
jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

// With PiggyVest off the status check never releases a primary id on a
// config-derived answer: the id is kept and nothing new is submitted.
describe('server keeps PiggyVest off', () => {
  it('keeps the operation for a merchant reported not primary', async () => {
    const clearOperation = jest.fn();
    await checkPendingPrimarySavings({
      merchantId: 'm',
      operationId: 'op',
      clearOperation,
      clearAmount: jest.fn(),
      refetchWallet: jest.fn(async () => undefined),
      setPending: jest.fn(),
    });
    expect(clearOperation).not.toHaveBeenCalled();
  });
});
