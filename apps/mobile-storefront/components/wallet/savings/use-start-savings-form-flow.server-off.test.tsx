import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useStartSavingsFormFlow } from './use-start-savings-form-flow';

// With PiggyVest off there is no primary wallet: a wallet head start is
// debited at plan creation, never deferred to the PiggyVest sheet.
describe('start savings form flow with the server off', () => {
  it('creates the plan with its head start in one step', async () => {
    const submitSavingsGoal = jest.fn(async () => undefined);
    const { result } = renderHook(() =>
      useStartSavingsFormFlow({
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
      })
    );
    await result.current.handleFundingContinue();
    expect(submitSavingsGoal).toHaveBeenCalledWith();
  });
});
