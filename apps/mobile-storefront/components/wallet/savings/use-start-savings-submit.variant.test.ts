import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import {
  runSavingsGoalSubmission,
  type UseStartSavingsSubmitInput,
} from './run-savings-goal-submission';
import { useStartSavingsSubmit } from './use-start-savings-submit';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/components/ui/show-app-alert', () => ({
  showAppAlert: jest.fn(),
}));
jest.mock('@/lib/clipboard', () => ({ setClipboardString: jest.fn() }));
jest.mock('@/lib/customer-savings', () => ({
  initializeSavingsAuthorization: jest.fn(),
}));
jest.mock('./run-savings-goal-submission', () => ({
  runSavingsGoalSubmission: jest.fn(async () => undefined),
}));

describe('submit exact variant boundary', () => {
  it('rejects an unresolved selection at final submission even after preview validation', async () => {
    const setFormError = jest.fn();
    const input: UseStartSavingsSubmitInput = {
      contributionValue: 100,
      effectiveInitialContribution: 0,
      frequency: 'daily',
      fundingAccount: null,
    initialContributionIdempotencyKey: null,
    goalIdempotencyKey: null,
    setGoalIdempotencyKey: jest.fn(),
      maturityDate: '2026-12-01',
      preferredDebitTime: '06:20',
      refetch: jest.fn(async () => undefined),
      requiredTopUpAmount: 0,
      selectedPaymentMethodId: null,
      selectedProduct: {
        id: 'synthetic-product',
        image: '',
        name: 'Synthetic phone',
        price: 800,
        slug: 'synthetic',
        requiresVariantSelection: true,
        variantId: null,
      },
      setFormError,
      setInitialContributionIdempotencyKey: jest.fn(),
      setShowFundingModal: jest.fn(),
      setShowPreviewModal: jest.fn(),
      setShowSuccessModal: jest.fn(),
      setShowTransferModal: jest.fn(),
      sourceMode: 'manual',
      startDate: '2026-09-12',
      targetValue: 800,
    };
    const { result, rerender, unmount } = renderHook(
      (current: UseStartSavingsSubmitInput) => useStartSavingsSubmit(current),
      { initialProps: input }
    );
    await act(async () => {
      await result.current.submitSavingsGoal();
    });
    expect(runSavingsGoalSubmission).not.toHaveBeenCalled();
    expect(setFormError).toHaveBeenCalledWith(
      'Select the exact device variant you want to save for.'
    );
    expect(result.current.isSubmitting).toBe(false);
    if (!input.selectedProduct) throw new Error('Missing synthetic product');
    const validInput = {
      ...input,
      selectedProduct: {
        ...input.selectedProduct,
        requiresVariantSelection: false,
        variantId: 'variant-a',
      },
    };
    rerender(validInput);
    let finish: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    jest.mocked(runSavingsGoalSubmission).mockReturnValueOnce(pending);
    let submission: Promise<void> = Promise.resolve();
    act(() => {
      submission = result.current.submitSavingsGoal();
    });
    const isCurrent = jest.mocked(runSavingsGoalSubmission).mock.calls[0][2];
    expect(isCurrent?.()).toBe(true);
    rerender({
      ...validInput,
      selectedProduct: {
        ...validInput.selectedProduct,
        variantId: 'variant-b',
      },
    });
    expect(isCurrent?.()).toBe(false);
    rerender(validInput);
    expect(isCurrent?.()).toBe(false);
    unmount();
    await act(async () => {
      finish();
      await submission;
    });
  });
});
