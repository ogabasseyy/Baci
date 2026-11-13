import { beforeEach, describe, expect, it, jest } from '@jest/globals';
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
    operationRailRef: { current: null as 'primary' | 'legacy' | null },
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

describe('createWalletSavingsActions with PiggyVest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsHostedStagingTestPaymentsEnabled.mockReturnValue(false);
  });

  it('validates a legacy-bound retry against the legacy balance, not the primary one', () => {
    const operationRailRef = {
      current: 'legacy' as 'primary' | 'legacy' | null,
    };
    createWalletSavingsActions({
      ...createInput(),
      activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      idempotencyKeyRef: { current: 'stored-id' },
      operationRailRef,
      primaryReady: true,
      savingsContributionAmount: '1000',
      legacyBalance: 2000,
      spendableBalance: 0,
    }).handleAddSavingsContribution();
    expect(addSavingsContributionToGoal).toHaveBeenCalledWith(
      expect.objectContaining({ walletBalance: 2000 })
    );
  });

  it('validates a primary-rail contribution against the primary balance', () => {
    createWalletSavingsActions({
      ...createInput(),
      activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      primaryReady: true,
      legacyBalance: 2000,
      spendableBalance: 700,
    }).handleAddSavingsContribution();
    expect(addSavingsContributionToGoal).toHaveBeenCalledWith(
      expect.objectContaining({ walletBalance: 700 })
    );
  });

  describe('PiggyVest main wallet ready', () => {
    it('sends the customer to Add money instead of Paystack when the balance is too low', () => {
      const input = {
        ...createInput(),
        onAddMoney: jest.fn(),
        primaryReady: true,
        walletTopUp: {
          customer: null,
          user: null,
          setIsFundPending: jest.fn(),
        },
      };
      createWalletSavingsActions(input).handleFundSavingsWallet();

      expect(input.onAddMoney).toHaveBeenCalledTimes(1);
      expect(input.startWalletTopUp).not.toHaveBeenCalled();
    });

    it('does nothing when the PiggyVest balance already covers the amount', () => {
      const input = {
        ...createInput(),
        onAddMoney: jest.fn(),
        primaryReady: true,
        spendableBalance: 5000,
      };
      createWalletSavingsActions(input).handleFundSavingsWallet();

      expect(input.onAddMoney).not.toHaveBeenCalled();
      expect(input.startWalletTopUp).not.toHaveBeenCalled();
    });

    it('keeps the Paystack top-up for legacy wallets', () => {
      const input = { ...createInput(), onAddMoney: jest.fn() };
      createWalletSavingsActions(input).handleFundSavingsWallet();

      expect(input.startWalletTopUp).toHaveBeenCalledTimes(1);
      expect(input.onAddMoney).not.toHaveBeenCalled();
    });
  });

  describe('a late status check', () => {
    type CheckInput = Parameters<typeof checkPendingPrimarySavings>[0];
    function startCheck() {
      const input = {
        ...createInput(),
        activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      };
      input.idempotencyKeyRef.current = 'op-1';
      input.operationRailRef.current = 'primary';
      void createWalletSavingsActions(input).handleAddSavingsContribution();
      const check = jest.mocked(checkPendingPrimarySavings).mock
        .calls[0]?.[0] as CheckInput;
      return { check, input };
    }

    it('leaves a newer operation alone once the stored id has changed', () => {
      const { check, input } = startCheck();
      input.idempotencyKeyRef.current = 'op-2';
      check.clearOperation();
      check.clearAmount();
      check.setPending(false);
      expect(input.idempotencyKeyRef.current).toBe('op-2');
      expect(input.setSavingsContributionAmount).not.toHaveBeenCalled();
      expect(input.setIsAddingSavingsContribution).not.toHaveBeenCalled();
    });

    it('still clears the busy flag it set before the scope changed', () => {
      const { check, input } = startCheck();
      check.setPending(true);
      input.idempotencyKeyRef.current = 'op-2';
      check.clearOperation();
      check.setPending(false);
      expect(input.idempotencyKeyRef.current).toBe('op-2');
      expect(input.setIsAddingSavingsContribution.mock.calls).toEqual([
        [true],
        [false],
      ]);
    });

    it('settles its own operation, amount and busy flag', () => {
      const { check, input } = startCheck();
      check.setPending(true);
      check.clearOperation();
      check.clearAmount();
      check.setPending(false);
      expect(input.idempotencyKeyRef.current).toBeNull();
      expect(input.operationRailRef.current).toBeNull();
      expect(input.setSavingsContributionAmount).toHaveBeenCalledWith('');
      expect(input.setIsAddingSavingsContribution).toHaveBeenLastCalledWith(
        false
      );
    });
  });
});
