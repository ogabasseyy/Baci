import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { addSavingsContribution } from '@/lib/customer-savings';
import { checkPendingPrimarySavings } from './check-pending-primary-savings';
import { savingsNotifier } from './savings/savings-notice';
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
    walletBalance: 0,
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

  it('never opens a plan bank account screen, even in hosted staging', () => {
    const input = createInput();
    mockIsHostedStagingTestPaymentsEnabled.mockReturnValue(true);

    createWalletSavingsActions(input).handleFundSavingsWallet();

    expect(router.push).not.toHaveBeenCalled();
    expect(input.startWalletTopUp).toHaveBeenCalledTimes(1);
  });

  it('does not open plan transfer when the wallet already covers the amount', () => {
    const input = createInput();
    input.walletBalance = 2500;

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
      input.walletBalance = balance;
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

  const settledGoal: WalletActiveSavingsGoal = {
    ...activeGoal,
    status: 'completed',
    current_amount: 0,
    target_amount: 5000,
  };

  it('opens the progress sheet for a funded goal awaiting settlement', () => {
    const input = {
      ...createInput({ ...settledGoal, current_amount: 5000 }),
      goalAwaitingSettlement: true,
    };
    createWalletSavingsActions(input).handleOpenSavings();
    expect(input.setShowSavingsProgressModal).toHaveBeenCalledWith(true);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('does nothing while the readiness verdict for a funded completed goal is still being read', () => {
    const input = {
      ...createInput({ ...settledGoal, current_amount: 5000 }),
      goalAwaitingSettlement: false,
      goalSettlementChecking: true,
    };
    createWalletSavingsActions(input).handleOpenSavings();
    expect(input.setShowSavingsProgressModal).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('starts another plan once a completed goal is settled', () => {
    const input = {
      ...createInput(settledGoal),
      goalAwaitingSettlement: false,
    };
    createWalletSavingsActions(input).handleOpenSavings();
    expect(router.push).toHaveBeenCalledWith('/wallet/savings/start');
    expect(input.setShowSavingsProgressModal).not.toHaveBeenCalled();
  });

  it('keeps legacy completed goals on start another plan', () => {
    const input = createInput({ ...settledGoal, current_amount: 5000 });
    createWalletSavingsActions(input).handleOpenSavings();
    expect(router.push).toHaveBeenCalledWith('/wallet/savings/start');
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

  describe('stored operation rail', () => {
    const PRIMARY_MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
    const withRail = (
      key: string | null,
      rail: 'primary' | 'legacy' | null,
      merchant?: string
    ) => ({
      ...createInput(),
      activeMerchantId: merchant,
      idempotencyKeyRef: { current: key },
      operationRailRef: { current: rail },
    });

    it('records the rail before the request for a fresh id', () => {
      const input = withRail(null, null, PRIMARY_MERCHANT);
      createWalletSavingsActions(input).handleAddSavingsContribution();
      const [request] = jest.mocked(addSavingsContributionToGoal).mock.calls[0];
      expect(request.createIdempotencyKey()).toBe('synthetic-key');
      expect(input.operationRailRef.current).toBe('primary');
      request.clearIdempotencyKey?.();
      expect(input.operationRailRef.current).toBeNull();
    });

    it('retries a stored legacy id on legacy only after the merchant becomes primary', () => {
      const input = withRail('legacy-op', 'legacy', PRIMARY_MERCHANT);
      createWalletSavingsActions(input).handleAddSavingsContribution();
      expect(checkPendingPrimarySavings).not.toHaveBeenCalled();
      const [request] = jest.mocked(addSavingsContributionToGoal).mock.calls[0];
      expect(request.addSavingsContribution).toBe(addSavingsContribution);
      expect(request.createIdempotencyKey()).toBe('legacy-op');
      expect(input.operationRailRef.current).toBe('legacy');
    });

    it('keeps a stored primary id and submits nothing once the merchant is no longer primary', () => {
      const input = withRail('primary-op', 'primary', undefined);
      createWalletSavingsActions(input).handleAddSavingsContribution();
      expect(addSavingsContributionToGoal).not.toHaveBeenCalled();
      expect(checkPendingPrimarySavings).not.toHaveBeenCalled();
      expect(savingsNotifier()).toHaveBeenCalledWith(
        'Still checking',
        expect.stringContaining('We are checking your earlier contribution'),
        'warning'
      );
      expect(input.idempotencyKeyRef.current).toBe('primary-op');
      expect(input.operationRailRef.current).toBe('primary');
    });

    it('releases id and rail together when the primary check releases the operation', () => {
      const input = withRail('primary-op', 'primary', PRIMARY_MERCHANT);
      createWalletSavingsActions(input).handleAddSavingsContribution();
      const [check] = jest.mocked(checkPendingPrimarySavings).mock.calls[0];
      check.clearOperation();
      expect(input.idempotencyKeyRef.current).toBeNull();
      expect(input.operationRailRef.current).toBeNull();
    });
  });
});
