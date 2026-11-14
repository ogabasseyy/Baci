import { renderHook } from '@testing-library/react-native';
import { useWalletSavingsController } from './use-wallet-savings-controller';

jest.mock('./use-primary-savings-recovery', () => ({
  usePrimarySavingsRecovery: () => ({ ready: true, retry: jest.fn() }),
}));
jest.mock('./use-wallet-savings-actions', () => ({
  createWalletSavingsActions: () => ({
    hasPendingSavingsContribution: false,
    handleAddSavingsContribution: jest.fn(),
    handleFundSavingsWallet: jest.fn(),
  }),
}));

// With PiggyVest off the controller starts with no stored id or rail and
// releases the legacy actions as soon as recovery finds nothing.
describe('server keeps PiggyVest off', () => {
  it('keeps no id or rail and exposes no pending contribution', () => {
    const idempotencyKeyRef = { current: null as string | null };
    const operationRailRef = {
      current: null as 'primary' | 'legacy' | null,
    };
    const { result } = renderHook(() =>
      useWalletSavingsController({
        goal: null,
        idempotencyKeyRef,
        operationRailRef,
        refetchWallet: async () => undefined,
        savingsContributionAmount: '',
        walletBalance: 0,
        setIsAddingSavingsContribution: jest.fn(),
        setShowSavingsProgressModal: jest.fn(),
        setSavingsContributionAmount: jest.fn(),
      })
    );
    expect(result.current.hasPendingSavingsContribution).toBe(false);
    expect(idempotencyKeyRef.current).toBeNull();
    expect(operationRailRef.current).toBeNull();
  });
});
