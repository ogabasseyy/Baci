import { renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useWalletSavingsController } from './use-wallet-savings-controller';

const mockRetry = jest.fn();
const mockSubmit = jest.fn();
const mockFund = jest.fn();
let mockReady = false;
jest.mock('./use-primary-savings-recovery', () => ({
  usePrimarySavingsRecovery: () => ({ ready: mockReady, retry: mockRetry }),
}));
const mockCreateActions = jest.fn();
jest.mock('./use-wallet-savings-actions', () => ({
  createWalletSavingsActions: (...args: unknown[]) => {
    mockCreateActions(...args);
    return {
      hasPendingSavingsContribution: true,
      handleAddSavingsContribution: mockSubmit,
      handleFundSavingsWallet: mockFund,
    };
  },
}));
jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
const input = {
  goal: null,
  idempotencyKeyRef: { current: null },
  operationRailRef: { current: null },
  refetchWallet: async () => undefined,
  savingsContributionAmount: '',
  spendableBalance: 0,
  setIsAddingSavingsContribution: jest.fn(),
  setShowSavingsProgressModal: jest.fn(),
  setSavingsContributionAmount: jest.fn(),
};
beforeEach(() => {
  jest.clearAllMocks();
  mockReady = false;
});
it('blocks funding and submission until pending recovery is confirmed', () => {
  const { result } = renderHook(() => useWalletSavingsController(input));
  result.current.handleAddSavingsContribution();
  result.current.handleFundSavingsWallet();
  expect(mockSubmit).not.toHaveBeenCalled();
  expect(mockFund).not.toHaveBeenCalled();
  expect(mockRetry).toHaveBeenCalledTimes(2);
});
it('uses existing operation actions once recovery is ready', () => {
  mockReady = true;
  const { result } = renderHook(() => useWalletSavingsController(input));
  result.current.handleAddSavingsContribution();
  expect(mockSubmit).toHaveBeenCalledTimes(1);
  expect(result.current.hasPendingSavingsContribution).toBe(true);
});
it('drops the pending key when the scope changes so no foreign operation is queried', () => {
  const idempotencyKeyRef: { current: string | null } = { current: null };
  const operationRailRef: { current: 'primary' | 'legacy' | null } = {
    current: null,
  };
  const { rerender } = renderHook(
    ({ userId }: { userId: string }) =>
      useWalletSavingsController({
        ...input,
        idempotencyKeyRef,
        operationRailRef,
        userId,
      }),
    { initialProps: { userId: 'user-a' } }
  );
  // A key created during the session survives same-scope re-renders.
  idempotencyKeyRef.current = 'created-operation';
  operationRailRef.current = 'legacy';
  rerender({ userId: 'user-a' });
  expect(idempotencyKeyRef.current).toBe('created-operation');
  expect(operationRailRef.current).toBe('legacy');
  // An account switch drops it before any status query could clear it
  // as not_found under the new identity.
  rerender({ userId: 'user-b' });
  expect(idempotencyKeyRef.current).toBeNull();
  expect(operationRailRef.current).toBeNull();
});
it('hands the PiggyVest verdict and Add money callback to the savings actions', () => {
  mockReady = true;
  const onAddMoney = jest.fn();
  renderHook(() =>
    useWalletSavingsController({ ...input, onAddMoney, primaryReady: true })
  );
  expect(mockCreateActions).toHaveBeenCalledWith(
    expect.objectContaining({ onAddMoney, primaryReady: true })
  );
});
