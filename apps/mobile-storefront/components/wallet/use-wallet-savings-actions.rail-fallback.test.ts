import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { addPiggyvestPrimarySavingsContribution } from '@/lib/piggyvest-primary-savings';
import { createWalletSavingsActions } from './use-wallet-savings-actions';
import { addSavingsContributionToGoal } from './wallet-screen-savings.handlers';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-key' }));
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

const PILOT_MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

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

type ContributionInput = {
  amount: number;
  goalId: string;
  idempotencyKey: string;
  merchantId?: string;
  merchantSlug?: string;
};

describe('wallet-screen contribution rail after a primary fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records the legacy rail when the primary helper falls back', async () => {
    const operationRailRef = { current: null as 'primary' | 'legacy' | null };
    jest
      .mocked(addPiggyvestPrimarySavingsContribution)
      .mockImplementation(async (input) => {
        input.onRail?.('primary');
        input.onRail?.('legacy');
        throw new Error('response lost');
      });
    createWalletSavingsActions({
      activeMerchantId: PILOT_MERCHANT_ID,
      goal,
      idempotencyKeyRef: { current: null },
      operationRailRef,
      refetchWallet: jest.fn(async () => undefined),
      savingsContributionAmount: '2500',
      walletBalance: 5000,
      startWalletTopUp: jest.fn(),
      setIsAddingSavingsContribution: jest.fn(),
      setShowSavingsProgressModal: jest.fn(),
      setSavingsContributionAmount: jest.fn(),
    }).handleAddSavingsContribution();

    const params = jest.mocked(addSavingsContributionToGoal).mock.calls[0]?.[0];
    expect(params).toBeDefined();
    const key = params?.createIdempotencyKey();
    expect(operationRailRef.current).toBe('primary');
    const contribution: ContributionInput = {
      amount: 2500,
      goalId: goal.id,
      idempotencyKey: key ?? '',
      merchantId: PILOT_MERCHANT_ID,
    };
    await expect(params?.addSavingsContribution(contribution)).rejects.toThrow(
      'response lost'
    );

    // The id was last sent on legacy, so a retry must stay on legacy.
    expect(operationRailRef.current).toBe('legacy');
  });
});
