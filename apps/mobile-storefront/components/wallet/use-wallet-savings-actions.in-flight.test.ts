import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { createWalletSavingsActions } from './use-wallet-savings-actions';
import { addSavingsContributionToGoal } from './wallet-screen-savings.handlers';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('./savings/savings-notice', () => {
  const notify = jest.fn();
  return { savingsNotifier: () => notify };
});
jest.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-key' }));
jest.mock('./check-pending-primary-savings', () => ({
  checkPendingPrimarySavings: jest.fn(),
}));
jest.mock('@/lib/customer-savings', () => ({
  addSavingsContribution: jest.fn(),
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(),
}));
jest.mock('./wallet-screen-savings.handlers', () => ({
  addSavingsContributionToGoal: jest.fn(),
}));

const PRIMARY_MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const goal: WalletActiveSavingsGoal = {
  id: 'goal-1',
  title: 'Synthetic device',
  status: 'active',
  source_mode: 'manual',
  current_amount: 100,
  target_amount: 700000,
  contribution_amount: 100,
  contribution_frequency: 'weekly',
  maturity_date: '2026-12-01',
};

type Handler = {
  createIdempotencyKey: () => string;
  setIsAddingSavingsContribution: (value: boolean) => void;
};

beforeEach(() => {
  jest.clearAllMocks();
});

// Walk 13: every add flashed the "awaiting confirmation" card, because the
// operation id the add itself stores was read as an earlier unresolved one.
describe('bugfix: an add in flight is not an earlier pending contribution', () => {
  it('shows pending only once the add ends with its operation unresolved', () => {
    const input = {
      activeMerchantId: PRIMARY_MERCHANT,
      goal,
      idempotencyKeyRef: { current: null as string | null },
      operationRailRef: { current: null as 'primary' | 'legacy' | null },
      submittingRef: { current: false },
      refetchWallet: jest.fn(async () => undefined),
      savingsContributionAmount: '2500',
      spendableBalance: 5000,
      // #4216 renames the balance input to walletBalance: pass both so this
      // test compiles before and after that lands.
      walletBalance: 5000,
      setIsAddingSavingsContribution: jest.fn<(value: boolean) => void>(),
      setShowSavingsProgressModal: jest.fn<(value: boolean) => void>(),
      setSavingsContributionAmount: jest.fn<(value: string) => void>(),
    };
    let handler: Handler | undefined;
    jest.mocked(addSavingsContributionToGoal).mockImplementation((async (
      args: Handler
    ) => {
      handler = args;
    }) as never);
    createWalletSavingsActions(input).handleAddSavingsContribution();
    if (!handler) throw new Error('the add did not start');
    handler.setIsAddingSavingsContribution(true);
    handler.createIdempotencyKey();
    // A render while the add is in flight: not "awaiting confirmation".
    expect(
      createWalletSavingsActions(input).hasPendingSavingsContribution
    ).toBe(false);
    // The add ends without a verdict and keeps its id for a safe retry.
    handler.setIsAddingSavingsContribution(false);
    expect(
      createWalletSavingsActions(input).hasPendingSavingsContribution
    ).toBe(true);
    expect(input.setIsAddingSavingsContribution).toHaveBeenLastCalledWith(
      false
    );
  });
});
