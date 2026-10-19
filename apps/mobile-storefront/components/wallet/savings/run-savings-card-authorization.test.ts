import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';
import { showAppAlert } from '@/components/ui/show-app-alert';
import type { UseStartSavingsSubmitInput } from './run-savings-goal-submission';
import { useStartSavingsSubmit } from './use-start-savings-submit';

type Authorization = {
  authorization_url: string;
  gateway: string;
  reference: string;
};
const mockInitialize =
  jest.fn<(...args: unknown[]) => Promise<Authorization>>();
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/components/ui/show-app-alert', () => ({
  showAppAlert: jest.fn(),
}));
jest.mock('@/lib/clipboard', () => ({ setClipboardString: jest.fn() }));
jest.mock('@/lib/customer-savings', () => ({
  initializeSavingsAuthorization: (...args: unknown[]) =>
    mockInitialize(...args),
}));
jest.mock('./run-savings-goal-submission', () => ({
  runSavingsGoalSubmission: jest.fn(),
}));

function fixture(): UseStartSavingsSubmitInput {
  return {
    activeMerchantId: 'merchant-a',
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
    selectedProduct: null,
    setFormError: jest.fn(),
    setInitialContributionIdempotencyKey: jest.fn(),
    setShowFundingModal: jest.fn(),
    setShowPreviewModal: jest.fn(),
    setShowSuccessModal: jest.fn(),
    setShowTransferModal: jest.fn(),
    sourceMode: 'auto_debit',
    startDate: '2026-09-12',
    targetValue: 800,
  };
}

describe('card authorization context lifetime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it.each([
    'switch-success',
    'switch-failure',
    'unmount-success',
    'unmount-failure',
  ])('suppresses stale navigation and alerts after %s without claiming provider cancellation', async (scenario) => {
    let complete: (value: Authorization) => void = () => undefined;
    let fail: (error: Error) => void = () => undefined;
    const pending = new Promise<Authorization>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    mockInitialize.mockReturnValueOnce(pending);
    const input = fixture();
    const { result, rerender, unmount } = renderHook(
      (current: UseStartSavingsSubmitInput) => useStartSavingsSubmit(current),
      { initialProps: input }
    );
    let authorization: Promise<void> = Promise.resolve();
    act(() => {
      authorization = result.current.handleAuthorizeSavingsCard();
    });
    if (scenario.startsWith('switch'))
      rerender({ ...input, activeMerchantId: 'merchant-b' });
    else unmount();
    await act(async () => {
      if (scenario.endsWith('success'))
        complete({
          authorization_url: 'https://example.test/authorization',
          gateway: 'paystack',
          reference: 'synthetic',
        });
      else fail(new Error('Synthetic error'));
      await authorization;
    });
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    expect(showAppAlert).not.toHaveBeenCalled();
    expect(input.setShowFundingModal).not.toHaveBeenCalled();
    if (scenario.startsWith('switch'))
      expect(result.current.isAuthorizingCard).toBe(false);
  });
});
