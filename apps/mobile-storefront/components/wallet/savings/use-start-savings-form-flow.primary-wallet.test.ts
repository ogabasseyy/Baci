import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import {
  PRIMARY_HEAD_START_WHOLE_NAIRA_MESSAGE,
  resolveStartSavingsWalletBalance,
} from './start-savings-wallet-balance';
import {
  PRIMARY_HEAD_START_ABOVE_TARGET_MESSAGE,
  useStartSavingsFormFlow,
} from './use-start-savings-form-flow';

type FlowInput = Parameters<typeof useStartSavingsFormFlow>[0];

function createFlow(overrides: Partial<FlowInput> = {}) {
  const submitSavingsGoal = jest.fn(async () => undefined);
  const input: FlowInput = {
    acceptsNonWithdrawableTerms: true,
    contributionValue: 5000,
    initialContributionEnabled: true,
    initialContributionValue: 10000,
    refetch: jest.fn(async () => undefined),
    selectedFundingOption: 'wallet',
    selectedPaymentMethodId: null,
    selectedProduct: null,
    setCreatedGoalId: jest.fn(),
    setFormError: jest.fn(),
    setInitialContributionAmount: jest.fn(),
    setInitialContributionEnabled: jest.fn(),
    setPaymentMethodsError: jest.fn(),
    setShowPreviewModal: jest.fn(),
    setShowSuccessModal: jest.fn(),
    setShowTransferModal: jest.fn(),
    setSourceMode: jest.fn(),
    sourceMode: 'manual',
    submitSavingsGoal,
    targetValue: 250000,
    ...overrides,
  };
  const { result } = renderHook(() => useStartSavingsFormFlow(input));
  return { flow: result.current, submitSavingsGoal, input };
}

describe('start savings with a PiggyVest wallet', () => {
  it('creates the plan first and moves a wallet head start through PiggyVest', async () => {
    const { flow, submitSavingsGoal } = createFlow({ primaryWallet: true });
    await flow.handleFundingContinue();
    expect(submitSavingsGoal).toHaveBeenCalledWith({
      deferInitialContribution: true,
      continueInWallet: true,
      confirmPrimaryBalance: true,
    });
  });

  it('asks for a whole-naira head start instead of rounding it up', async () => {
    const { flow, submitSavingsGoal, input } = createFlow({
      primaryWallet: true,
      initialContributionValue: 10_000.4,
    });
    await flow.handleFundingContinue();
    expect(submitSavingsGoal).not.toHaveBeenCalled();
    expect(input.setFormError).toHaveBeenCalledWith(
      PRIMARY_HEAD_START_WHOLE_NAIRA_MESSAGE
    );
  });

  it('refuses a head start above the plan target, creating nothing', async () => {
    const { flow, submitSavingsGoal, input } = createFlow({
      primaryWallet: true,
      initialContributionValue: 20_000,
      targetValue: 10_000,
    });
    await flow.handleFundingContinue();
    expect(submitSavingsGoal).not.toHaveBeenCalled();
    expect(input.setFormError).toHaveBeenCalledWith(
      PRIMARY_HEAD_START_ABOVE_TARGET_MESSAGE
    );
  });

  it('creates a PiggyVest plan with no head start directly', async () => {
    const { flow, submitSavingsGoal } = createFlow({
      primaryWallet: true,
      initialContributionEnabled: false,
      initialContributionValue: 0,
    });
    await flow.handleFundingContinue();
    expect(submitSavingsGoal).toHaveBeenCalledWith();
  });

  it('keeps the legacy wallet head start unchanged', async () => {
    const { flow, submitSavingsGoal } = createFlow();
    await flow.handleFundingContinue();
    expect(submitSavingsGoal).toHaveBeenCalledWith();
  });

  it('ignores a stale bank-transfer choice and moves the head start through the wallet', async () => {
    const { flow, submitSavingsGoal } = createFlow({
      primaryWallet: true,
      selectedFundingOption: 'bank_transfer',
    });
    await flow.handleFundingContinue();
    expect(submitSavingsGoal).toHaveBeenCalledWith({
      deferInitialContribution: true,
      continueInWallet: true,
      confirmPrimaryBalance: true,
    });
  });
});

describe('resolveStartSavingsWalletBalance', () => {
  it('shows the PiggyVest balance in naira, not the empty legacy wallet', () => {
    expect(
      resolveStartSavingsWalletBalance({
        balance: 0,
        loyalty_points: 0,
        primary_balance_kobo: 5_000_000,
      })
    ).toEqual({ balance: 50000, primaryWallet: true });
  });

  it('falls back to the legacy balance without a PiggyVest balance', () => {
    expect(
      resolveStartSavingsWalletBalance({ balance: 1200, loyalty_points: 0 })
    ).toEqual({ balance: 1200, primaryWallet: false });
    expect(
      resolveStartSavingsWalletBalance({
        balance: 1200,
        loyalty_points: 0,
        primary_balance_kobo: -1,
      })
    ).toEqual({ balance: 1200, primaryWallet: false });
    expect(resolveStartSavingsWalletBalance(undefined)).toEqual({
      balance: 0,
      primaryWallet: false,
    });
  });
});
