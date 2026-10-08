import { beforeEach, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import { checkPendingPrimarySavings } from './check-pending-primary-savings';

const mockCheck = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/piggyvest-primary-savings-status', () => ({
  checkPiggyvestPrimarySavingsStatus: (...args: unknown[]) =>
    mockCheck(...args),
}));
jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
function input() {
  return {
    merchantId: 'merchant',
    operationId: 'operation',
    clearOperation: jest.fn(),
    clearAmount: jest.fn(),
    refetchWallet: jest.fn(async () => undefined),
    setPending: jest.fn<(value: boolean) => void>(),
  };
}
beforeEach(() => {
  jest.clearAllMocks();
});
it('keeps the operation and amount on pending status even when spendable funds are zero', async () => {
  const props = input();
  mockCheck.mockResolvedValue({ status: 'pending', operationId: 'operation' });
  await checkPendingPrimarySavings(props);
  expect(props.clearOperation).not.toHaveBeenCalled();
  expect(props.clearAmount).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith(
    'Contribution pending',
    expect.any(String)
  );
});
it('clears the retained operation only after confirmed settlement', async () => {
  const props = input();
  mockCheck.mockResolvedValue({
    status: 'confirmed',
    operationId: 'operation',
  });
  await checkPendingPrimarySavings(props);
  expect(props.clearOperation).toHaveBeenCalledTimes(1);
  expect(props.clearAmount).toHaveBeenCalledTimes(1);
  expect(props.refetchWallet).toHaveBeenCalledTimes(1);
});
it('preserves retry identity when status is unavailable', async () => {
  const props = input();
  mockCheck.mockRejectedValue(new Error('unavailable'));
  await checkPendingPrimarySavings(props);
  expect(props.clearOperation).not.toHaveBeenCalled();
  expect(props.clearAmount).not.toHaveBeenCalled();
  expect(props.setPending).toHaveBeenLastCalledWith(false);
});
