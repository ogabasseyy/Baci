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
