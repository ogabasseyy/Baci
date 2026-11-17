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
const mockGate = jest.fn();
jest.mock('./savings/use-primary-goal-gate', () => ({
  usePrimaryGoalGate: (key?: number) => mockGate(key),
}));
const mockCreateActions = jest.fn();
jest.mock('./use-wallet-savings-actions', () => ({
  createWalletSavingsActions: (args: unknown) => {
    mockCreateActions(args);
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
  walletBalance: 0,
  setIsAddingSavingsContribution: jest.fn(),
  setShowSavingsProgressModal: jest.fn(),
  setSavingsContributionAmount: jest.fn(),
};
beforeEach(() => {
  jest.clearAllMocks();
  mockReady = false;
  mockGate.mockReturnValue('off');
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

describe('goalAwaitingSettlement', () => {
  const funded = { id: 'g', status: 'completed', current_amount: 5000 };
  it.each([
    ['ready', funded, true],
    ['off', funded, false],
    ['checking', funded, false],
    ['ready', { ...funded, current_amount: 0 }, false],
    ['ready', { ...funded, status: 'active' }, false],
  ])('gate %s with %j -> %s', (gate, goal, expected) => {
    mockGate.mockReturnValue(gate);
    const { result } = renderHook(() =>
      useWalletSavingsController({ ...input, goal } as never)
    );
    expect(result.current.goalAwaitingSettlement).toBe(expected);
    expect(mockCreateActions).toHaveBeenLastCalledWith(
      expect.objectContaining({ goalAwaitingSettlement: expected })
    );
  });

  it('re-reads the gate on a wallet refresh so a stale pending verdict resolves', () => {
    const goal = { id: 'g', status: 'completed', current_amount: 5000 };
    mockGate.mockImplementation((key?: number) =>
      key === 2 ? 'ready' : 'off'
    );
    const { result, rerender } = renderHook(
      ({ at }: { at: number }) =>
        useWalletSavingsController({
          ...input,
          goal,
          walletUpdatedAt: at,
        } as never),
      { initialProps: { at: 1 } }
    );
    expect(result.current.goalAwaitingSettlement).toBe(false);
    rerender({ at: 2 });
    expect(mockGate).toHaveBeenLastCalledWith(2);
    expect(result.current.goalAwaitingSettlement).toBe(true);
  });

  it('marks a funded completed goal as settlement-checking only while the gate is checking', () => {
    const goal = { id: 'g', status: 'completed', current_amount: 5000 };
    mockGate.mockReturnValue('checking');
    renderHook(() => useWalletSavingsController({ ...input, goal } as never));
    expect(mockCreateActions).toHaveBeenLastCalledWith(
      expect.objectContaining({ goalSettlementChecking: true })
    );
    mockGate.mockReturnValue('off');
    renderHook(() => useWalletSavingsController({ ...input, goal } as never));
    expect(mockCreateActions).toHaveBeenLastCalledWith(
      expect.objectContaining({ goalSettlementChecking: false })
    );
  });

  it('keeps a funded completed goal blocked after a transient gate error', () => {
    const goal = { id: 'g', status: 'completed', current_amount: 5000 };
    mockGate.mockReturnValue('error');
    const { result } = renderHook(() =>
      useWalletSavingsController({ ...input, goal } as never)
    );
    expect(result.current.goalAwaitingSettlement).toBe(false);
    expect(mockCreateActions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        goalAwaitingSettlement: false,
        goalSettlementChecking: true,
      })
    );
  });

  it('hands the wallet content its savings props, including the refresh time', () => {
    mockGate.mockReturnValue('ready');
    const goal = { id: 'g', status: 'completed', current_amount: 5000 };
    const { result } = renderHook(() =>
      useWalletSavingsController({
        ...input,
        goal,
        walletUpdatedAt: 42,
      } as never)
    );
    expect(result.current.walletContentSavingsProps).toEqual({
      hasPendingSavingsContribution:
        result.current.hasPendingSavingsContribution,
      goalAwaitingSettlement: true,
      walletUpdatedAt: 42,
    });
  });
});

describe('bugfix: completed goal offered "Start another plan" while unreachable (walk 11)', () => {
  const fundedCompleted = {
    id: 'goal-1',
    principal_amount: 500_000,
    current_amount: 500_000,
    status: 'completed',
  } as never;

  it('keeps "Complete goal" on the card while the check failed', () => {
    mockGate.mockReturnValue('error');
    const { result } = renderHook(() =>
      useWalletSavingsController({ ...input, goal: fundedCompleted })
    );
    expect(
      result.current.walletContentSavingsProps.goalAwaitingSettlement
    ).toBe(true);
    // The sheet's own action still waits for a ready check.
    expect(mockCreateActions).toHaveBeenLastCalledWith(
      expect.objectContaining({ goalAwaitingSettlement: false })
    );
  });

  it('keeps it while the check is still running', () => {
    mockGate.mockReturnValue('checking');
    const { result } = renderHook(() =>
      useWalletSavingsController({ ...input, goal: fundedCompleted })
    );
    expect(
      result.current.walletContentSavingsProps.goalAwaitingSettlement
    ).toBe(true);
  });

  it("keeps today's card where PiggyVest is off", () => {
    mockGate.mockReturnValue('off');
    const { result } = renderHook(() =>
      useWalletSavingsController({ ...input, goal: fundedCompleted })
    );
    expect(
      result.current.walletContentSavingsProps.goalAwaitingSettlement
    ).toBe(false);
  });
});
