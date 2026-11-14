import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { addSavingsContribution } from '@/lib/customer-savings';
import {
  clearObservedPiggyvestPrimaryCapability,
  NEGATIVE_CAPABILITY_TTL_MS,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import { addPiggyvestPrimarySavingsContribution } from '@/lib/piggyvest-primary-savings';
import { createWalletSavingsActions } from './use-wallet-savings-actions';
import { addSavingsContributionToGoal } from './wallet-screen-savings.handlers';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
// Outcomes are inline wallet notices (owner: no alerts on fund screens).
const mockNotify = jest.fn();
jest.mock('./savings/savings-notice', () => ({
  ...jest.requireActual<typeof import('./savings/savings-notice')>(
    './savings/savings-notice'
  ),
  savingsNotifier: () => mockNotify,
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-key' }));
jest.mock('./check-pending-primary-savings', () => ({
  checkPendingPrimarySavings: jest.fn(),
}));
jest.mock('@/lib/customer-savings', () => ({
  addSavingsContribution: jest.fn(async () => ({})),
}));
jest.mock('@/lib/piggyvest-primary-savings', () => ({
  addPiggyvestPrimarySavingsContribution: jest.fn(async () => ({})),
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(),
}));
jest.mock('./wallet-screen-savings.handlers', () => ({
  addSavingsContributionToGoal: jest.fn(),
}));

const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
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

afterEach(() => {
  clearObservedPiggyvestPrimaryCapability();
  jest.clearAllMocks();
});

describe('bugfix: rolled-back pilot contribution still sent to PiggyVest', () => {
  it('sends a new contribution on the legacy rail while the live verdict is false', async () => {
    // Arrange: the pilot was rolled back; the runtime may be back already,
    // but the wallet shows (and validates against) legacy funds.
    observePiggyvestPrimaryCapability(PILOT, false);
    const operationRailRef = { current: null as 'primary' | 'legacy' | null };

    // Act
    createWalletSavingsActions({
      activeMerchantId: PILOT,
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
    await params?.addSavingsContribution({
      amount: 2500,
      goalId: goal.id,
      idempotencyKey: params.createIdempotencyKey(),
      merchantId: PILOT,
    });

    // Assert
    expect(addPiggyvestPrimarySavingsContribution).not.toHaveBeenCalled();
    expect(addSavingsContribution).toHaveBeenCalledTimes(1);
  });
});

function contribute(primaryReady: boolean) {
  const refetchWallet = jest.fn(async () => undefined);
  createWalletSavingsActions({
    activeMerchantId: PILOT,
    goal,
    idempotencyKeyRef: { current: null },
    operationRailRef: { current: null },
    primaryReady,
    refetchWallet,
    savingsContributionAmount: '2500',
    walletBalance: 5000,
    startWalletTopUp: jest.fn(),
    setIsAddingSavingsContribution: jest.fn(),
    setShowSavingsProgressModal: jest.fn(),
    setSavingsContributionAmount: jest.fn(),
  }).handleAddSavingsContribution();
  return refetchWallet;
}

describe('bugfix: contribution sent to PiggyVest after a ruling-out expired', () => {
  it('holds a new contribution while the expired ruling-out still suppresses PiggyVest', () => {
    // Arrange: ruled out, then the 60 s ruling-out expires (verdict unknown)
    // while the wallet still shows legacy funds.
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    observePiggyvestPrimaryCapability(PILOT, false);
    clock.mockReturnValue(now + NEGATIVE_CAPABILITY_TTL_MS + 1);

    // Act
    const refetchWallet = contribute(false);

    // Assert: held and reloaded, never sent on either rail.
    expect(addSavingsContributionToGoal).not.toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledWith(
      'Still checking',
      expect.any(String),
      'warning'
    );
    expect(refetchWallet).toHaveBeenCalled();
    clock.mockRestore();
  });

  it('keeps the server-side fallback for a pilot with no verdict yet', () => {
    // Cold start: nothing observed, so nothing was ruled out.
    contribute(false);

    expect(addSavingsContributionToGoal).toHaveBeenCalledTimes(1);
  });
});
