import { renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useWalletSavingsController } from './use-wallet-savings-controller';

const mockRetry = jest.fn();
const mockSubmit = jest.fn();
const mockFund = jest.fn();
let mockReady = false;
let mockError = false;
jest.mock('./use-primary-savings-recovery', () => ({
  usePrimarySavingsRecovery: () => ({
    ready: mockReady,
    error: mockError,
    retry: mockRetry,
  }),
}));
jest.mock('./use-wallet-savings-actions', () => ({
  createWalletSavingsActions: () => ({
    hasPendingSavingsContribution: true,
    handleAddSavingsContribution: mockSubmit,
    handleFundSavingsWallet: mockFund,
  }),
}));
jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
const input = {
  goal: null,
  idempotencyKeyRef: { current: null },
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
  mockError = false;
});
it('allows wallet funding while still blocking savings submission during recovery', () => {
  const { result } = renderHook(() => useWalletSavingsController(input));
  result.current.handleAddSavingsContribution();
  result.current.handleFundSavingsWallet();
  expect(mockSubmit).not.toHaveBeenCalled();
  expect(mockFund).toHaveBeenCalledTimes(1);
  expect(mockRetry).toHaveBeenCalledTimes(1);
});
it('allows funding after recovery fails and explains the savings retry accurately', () => {
  mockError = true;
  const { result } = renderHook(() => useWalletSavingsController(input));
  result.current.handleFundSavingsWallet();
  expect(mockFund).toHaveBeenCalledTimes(1);
  expect(mockRetry).not.toHaveBeenCalled();
  result.current.handleAddSavingsContribution();
  expect(mockSubmit).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith(
    'Couldn’t check contributions',
    expect.stringContaining('You can still add money to your wallet')
  );
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
  const { rerender } = renderHook(
    ({ userId }: { userId: string }) =>
      useWalletSavingsController({ ...input, idempotencyKeyRef, userId }),
    { initialProps: { userId: 'user-a' } }
  );
  // A key created during the session survives same-scope re-renders.
  idempotencyKeyRef.current = 'created-operation';
  rerender({ userId: 'user-a' });
  expect(idempotencyKeyRef.current).toBe('created-operation');
  // An account switch drops it before any status query could clear it
  // as not_found under the new identity.
  rerender({ userId: 'user-b' });
  expect(idempotencyKeyRef.current).toBeNull();
});
