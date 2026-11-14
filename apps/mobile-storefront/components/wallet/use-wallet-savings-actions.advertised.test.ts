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
  addPiggyvestPrimarySavingsContribution: jest.fn(async () => ({})),
}));
jest.mock('@/lib/wallet-pin-proof', () => ({
  runWithPinProof: (run: (proof?: string) => unknown) => run(),
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(),
}));
jest.mock('./wallet-screen-savings.handlers', () => ({
  addSavingsContributionToGoal: jest.fn(),
}));

const goal: WalletActiveSavingsGoal = {
  id: 'goal-1',
  title: 'Device',
  status: 'active',
  source_mode: 'manual',
  current_amount: 100,
  target_amount: 700000,
  contribution_amount: 100,
  contribution_frequency: 'weekly',
  maturity_date: '2026-12-01',
};

async function submit(primaryReady: boolean) {
  createWalletSavingsActions({
    activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    goal,
    idempotencyKeyRef: { current: null },
    operationRailRef: { current: null },
    primaryReady,
    refetchWallet: jest.fn(async () => undefined),
    savingsContributionAmount: '500',
    walletBalance: 5000,
    setIsAddingSavingsContribution: jest.fn(),
    setShowSavingsProgressModal: jest.fn(),
    setSavingsContributionAmount: jest.fn(),
  }).handleAddSavingsContribution();
  const send = jest.mocked(addSavingsContributionToGoal).mock.calls[0][0]
    .addSavingsContribution;
  await send({
    amount: 500,
    goalId: 'goal-1',
    idempotencyKey: 'key',
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  });
  return jest.mocked(addPiggyvestPrimarySavingsContribution).mock.calls[0][0];
}

describe('primary contributions never fall back to legacy funds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks the primary request as advertised when the wallet is ready', async () => {
    expect((await submit(true)).primaryAdvertised).toBe(true);
  });

  it('keeps today’s fallback when the wallet is not ready', async () => {
    expect((await submit(false)).primaryAdvertised).toBe(false);
  });
});

describe('bugfix: contribution debits an unseen PiggyVest balance before the reload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('holds a new contribution while PiggyVest is confirmed but the wallet is still legacy', () => {
    // Arrange: the verdict turned positive; the wallet reload hasn't landed.
    const {
      clearObservedPiggyvestPrimaryCapability,
      observePiggyvestPrimaryCapability,
    } = jest.requireActual<
      typeof import('@/lib/piggyvest-primary-capability-cache')
    >('@/lib/piggyvest-primary-capability-cache');
    observePiggyvestPrimaryCapability(
      '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      true
    );
    const refetchWallet = jest.fn(async () => undefined);

    // Act
    createWalletSavingsActions({
      activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      goal,
      idempotencyKeyRef: { current: null },
      operationRailRef: { current: null },
      primaryReady: false,
      refetchWallet,
      savingsContributionAmount: '500',
      walletBalance: 5000,
      setIsAddingSavingsContribution: jest.fn(),
      setShowSavingsProgressModal: jest.fn(),
      setSavingsContributionAmount: jest.fn(),
    }).handleAddSavingsContribution();
    clearObservedPiggyvestPrimaryCapability();

    // Assert: nothing submitted; the wallet reloads.
    expect(addSavingsContributionToGoal).not.toHaveBeenCalled();
    expect(refetchWallet).toHaveBeenCalled();
  });
});
