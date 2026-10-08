import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { checkPendingPrimarySavings } from './check-pending-primary-savings';
import { createWalletSavingsActions } from './use-wallet-savings-actions';
import { addSavingsContributionToGoal } from './wallet-screen-savings.handlers';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-key' }));
jest.mock('./check-pending-primary-savings', () => ({
  checkPendingPrimarySavings: jest.fn(),
}));
const mockIsHostedStagingTestPaymentsEnabled = jest.fn();
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () =>
    mockIsHostedStagingTestPaymentsEnabled(),
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
const activeGoal: WalletActiveSavingsGoal = {
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

function createInput(goal: WalletActiveSavingsGoal | null = activeGoal) {
  return {
    goal,
    idempotencyKeyRef: { current: null as string | null },
    refetchWallet: jest.fn(async () => undefined),
    savingsContributionAmount: '2500',
    spendableBalance: 0,
    startWalletTopUp: jest.fn(),
    setIsFundPending: jest.fn<(value: boolean) => void>(),
    setIsAddingSavingsContribution: jest.fn<(value: boolean) => void>(),
    setShowSavingsProgressModal: jest.fn<(value: boolean) => void>(),
    setSavingsContributionAmount: jest.fn<(value: string) => void>(),
  };
}

describe('createWalletSavingsActions', () => {
  it('exposes pending status only for an existing primary-wallet operation', () => {
    const input = {
      ...createInput(),
      activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      idempotencyKeyRef: { current: 'pending-operation' },
    };
    expect(
      createWalletSavingsActions(input).hasPendingSavingsContribution
    ).toBe(true);
    expect(
      createWalletSavingsActions({
        ...input,
        activeMerchantId: 'other-merchant',
      }).hasPendingSavingsContribution
    ).toBe(false);
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsHostedStagingTestPaymentsEnabled.mockReturnValue(false);
  });

  it('opens plan creation when there is no active goal', () => {
    createWalletSavingsActions(createInput(null)).handleOpenSavings();
    expect(router.push).toHaveBeenCalledWith('/wallet/savings/start');
  });

  it('opens existing savings without starting a second goal', () => {
    const input = createInput({
      id: 'goal-1',
      title: 'Synthetic device',
      status: 'active',
      source_mode: 'manual',
      current_amount: 100,
      target_amount: 5000,
      contribution_amount: 100,
      contribution_frequency: 'weekly',
      maturity_date: '2026-12-01',
    });
    createWalletSavingsActions(input).handleOpenSavings();
    expect(input.setShowSavingsProgressModal).toHaveBeenCalledWith(true);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('keeps production savings funding on the existing wallet payment flow', () => {
    const input = createInput();
    createWalletSavingsActions(input).handleFundSavingsWallet();

    expect(input.startWalletTopUp).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('checks an existing primary contribution instead of starting another wallet payment', () => {
    const input = {
      ...createInput(),
      activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      idempotencyKeyRef: { current: 'pending-operation' },
    };
    mockIsHostedStagingTestPaymentsEnabled.mockReturnValue(true);

    createWalletSavingsActions(input).handleFundSavingsWallet();

    expect(checkPendingPrimarySavings).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'pending-operation' })
    );
    expect(input.startWalletTopUp).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(input.idempotencyKeyRef.current).toBe('pending-operation');
  });

  it('opens selected plan bank funding only in pinned hosted staging', () => {
    const input = createInput();
    mockIsHostedStagingTestPaymentsEnabled.mockReturnValue(true);

    createWalletSavingsActions(input).handleFundSavingsWallet();

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/savings/funding',
      params: { amount: '2500', goalId: 'goal-1' },
    });
    expect(input.startWalletTopUp).not.toHaveBeenCalled();
  });

  it('does not open plan transfer when the wallet already covers the amount', () => {
    const input = createInput();
    input.spendableBalance = 2500;

    createWalletSavingsActions(input).handleFundSavingsWallet();

    expect(router.push).not.toHaveBeenCalled();
  });

  it('does not start plan funding for empty, fully covered or above-goal amounts', () => {
    for (const [amount, balance] of [
      ['', 0],
      ['2500', 2500],
      ['700000', 0],
    ] as const) {
      const input = createInput();
      input.savingsContributionAmount = amount;
      input.spendableBalance = balance;
      createWalletSavingsActions(input).handleFundSavingsWallet();
      expect(router.push).not.toHaveBeenCalled();
    }
  });

  it('reopens completed unresolved savings instead of creating another plan', () => {
    const input = createInput({
      id: 'goal-1',
      title: 'Synthetic device',
      status: 'completed',
      selection_unresolved: true,
      source_mode: 'manual',
      current_amount: 5000,
      target_amount: 5000,
      contribution_amount: 100,
      contribution_frequency: 'weekly',
      maturity_date: '2026-12-01',
    });
    createWalletSavingsActions(input).handleOpenSavings();
    expect(input.setShowSavingsProgressModal).toHaveBeenCalledWith(true);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('retains a retry key until confirmed success clears it', () => {
    const input = createInput();
    input.idempotencyKeyRef.current = 'existing-attempt';
    createWalletSavingsActions(input).handleAddSavingsContribution();
    const [request] = jest.mocked(addSavingsContributionToGoal).mock.calls[0];
    expect(request.createIdempotencyKey()).toBe('existing-attempt');
    request.clearIdempotencyKey?.();
    expect(input.idempotencyKeyRef.current).toBeNull();
    expect(request.createIdempotencyKey()).toBe('synthetic-key');
  });
});
