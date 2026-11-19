import { addSavingsContribution } from '@/lib/customer-savings';
import { addPiggyvestPrimarySavingsContribution } from '@/lib/piggyvest-primary-savings';
import { SERVER_OFF_MERCHANT_ID } from '@/test-support/piggyvest-server-off.test-support';
import { checkPendingPrimarySavings } from './check-pending-primary-savings';
import { createWalletSavingsActions } from './use-wallet-savings-actions';
import { addSavingsContributionToGoal } from './wallet-screen-savings.handlers';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'fresh-op' }));
jest.mock('./check-pending-primary-savings', () => ({
  checkPendingPrimarySavings: jest.fn(),
}));
jest.mock('@/lib/customer-savings', () => ({
  addSavingsContribution: jest.fn(),
}));
jest.mock('@/lib/piggyvest-primary-savings', () => ({
  addPiggyvestPrimarySavingsContribution: jest.fn(),
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(),
}));
jest.mock('./wallet-screen-savings.handlers', () => ({
  addSavingsContributionToGoal: jest.fn(),
}));

const goal = {
  id: 'goal-1',
  title: 'Phone',
  status: 'active',
  source_mode: 'manual',
  current_amount: 100,
  target_amount: 700000,
  contribution_amount: 100,
  contribution_frequency: 'weekly',
  maturity_date: '2026-12-01',
} as const;

function actions(keyInRef: string | null) {
  return createWalletSavingsActions({
    activeMerchantId: SERVER_OFF_MERCHANT_ID,
    goal: goal as never,
    idempotencyKeyRef: { current: keyInRef },
    operationRailRef: { current: null },
    refetchWallet: jest.fn(async () => undefined),
    savingsContributionAmount: '2500',
    walletBalance: 5000,
    setIsAddingSavingsContribution: jest.fn(),
    setShowSavingsProgressModal: jest.fn(),
    setSavingsContributionAmount: jest.fn(),
  });
}

beforeEach(() => jest.clearAllMocks());

// A non-primary merchant keeps the production savings flow: the legacy add,
// no pending-primary check and no pending state, even with a stale key.
describe('server keeps PiggyVest off', () => {
  it('adds through the legacy contribution call', () => {
    actions(null).handleAddSavingsContribution();
    expect(addSavingsContributionToGoal).toHaveBeenCalledWith(
      expect.objectContaining({ addSavingsContribution })
    );
    expect(addSavingsContribution).not.toBe(
      addPiggyvestPrimarySavingsContribution
    );
    expect(checkPendingPrimarySavings).not.toHaveBeenCalled();
  });

  it('ignores a leftover key instead of checking a primary operation', () => {
    const result = actions('stale-key');
    expect(result.hasPendingSavingsContribution).toBe(false);
    result.handleAddSavingsContribution();
    expect(checkPendingPrimarySavings).not.toHaveBeenCalled();
    expect(addSavingsContributionToGoal).toHaveBeenCalledTimes(1);
  });

  it('keeps the card top-up and never opens Add money when primary is not ready', () => {
    const startWalletTopUp = jest.fn();
    const onAddMoney = jest.fn();
    createWalletSavingsActions({
      activeMerchantId: SERVER_OFF_MERCHANT_ID,
      goal: goal as never,
      idempotencyKeyRef: { current: null },
      onAddMoney,
      operationRailRef: { current: null },
      refetchWallet: jest.fn(async () => undefined),
      savingsContributionAmount: '2500',
      walletBalance: 0,
      startWalletTopUp,
      setIsAddingSavingsContribution: jest.fn(),
      setShowSavingsProgressModal: jest.fn(),
      setSavingsContributionAmount: jest.fn(),
    }).handleFundSavingsWallet();
    expect(startWalletTopUp).toHaveBeenCalledTimes(1);
    expect(onAddMoney).not.toHaveBeenCalled();
  });
});
