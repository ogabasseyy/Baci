import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useStartSavingsSubmit } from './use-start-savings-submit';

const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();
const mockCreateSavingsGoal =
  jest.fn<
    (...args: unknown[]) => Promise<{ goalId: string; success: boolean }>
  >();
const mockInitializeSavingsAuthorization =
  jest.fn<
    (...args: unknown[]) => Promise<{
      authorization_url: string;
      gateway: 'paystack';
      reference: string;
      success: true;
    }>
  >();
const mockSetClipboardString =
  jest.fn<(...args: unknown[]) => Promise<boolean>>();
const mockAddSavingsContribution =
  jest.fn<
    (...args: unknown[]) => Promise<{
      contributionId: string;
      goalCurrentAmount: number;
      goalStatus: string;
      success: boolean;
      walletBalance: number;
      walletTransactionId: string | null;
    }>
  >();
const mockCancelSavingsReminderNotification =
  jest.fn<(...args: unknown[]) => Promise<boolean>>();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'initial-key-1',
}));

jest.mock('@/lib/customer-savings', () => ({
  addSavingsContribution: (...args: unknown[]) =>
    mockAddSavingsContribution(...args),
  createSavingsGoal: (...args: unknown[]) => mockCreateSavingsGoal(...args),
  initializeSavingsAuthorization: (...args: unknown[]) =>
    mockInitializeSavingsAuthorization(...args),
}));

jest.mock('@/lib/clipboard', () => ({
  setClipboardString: (...args: unknown[]) => mockSetClipboardString(...args),
}));

jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: (...args: unknown[]) =>
    mockCancelSavingsReminderNotification(...args),
  scheduleSavingsReminderNotification: jest.fn(async () => 'reminder-1'),
}));

function createInput(overrides = {}) {
  return {
    activeMerchantId: 'merchant-1',
    activeMerchantSlug: 'ogabassey',
    contributionValue: 20000,
    effectiveInitialContribution: 20000,
    frequency: 'daily' as const,
    fundingAccount: { account_number: '0123456789' },
    initialContributionIdempotencyKey: null,
    goalIdempotencyKey: null,
    setGoalIdempotencyKey: jest.fn(),
    maturityDate: '2026-06-30',
    preferredDebitTime: '06:20',
    refetch: jest.fn(async () => undefined),
    requiredTopUpAmount: 50000,
    selectedPaymentMethodId: null,
    selectedProduct: {
      id: 'product-1',
      image: 'https://example.com/iphone.jpg',
      name: 'iPhone 13 Pro Max',
      price: 800000,
      slug: 'iphone-13-pro-max',
      requiresVariantSelection: false,
      variantId: null,
    },
    setFormError: jest.fn(),
    setInitialContributionIdempotencyKey: jest.fn(),
    setShowFundingModal: jest.fn(),
    setShowPreviewModal: jest.fn(),
    setShowSuccessModal: jest.fn(),
    setShowTransferModal: jest.fn(),
    sourceMode: 'manual' as const,
    startDate: '2026-05-22',
    targetValue: 800000,
    variantId: undefined,
    ...overrides,
  };
}

describe('useStartSavingsSubmit actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockInitializeSavingsAuthorization.mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com/auth',
      gateway: 'paystack',
      reference: 'AUTH-1',
      success: true,
    });
    mockSetClipboardString.mockResolvedValue(true);
    mockCancelSavingsReminderNotification.mockResolvedValue(true);
    mockAddSavingsContribution.mockResolvedValue({
      contributionId: 'contrib-1',
      goalCurrentAmount: 20000,
      goalStatus: 'active',
      success: true,
      walletBalance: 0,
      walletTransactionId: 'txn-1',
    });
  });

  it('opens Paystack authorization route with correct params', async () => {
    const { result } = renderHook(() => useStartSavingsSubmit(createInput()));

    await act(async () => {
      await result.current.handleAuthorizeSavingsCard();
    });

    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/payment-gateway',
        params: expect.objectContaining({
          merchantId: 'merchant-1',
          merchantSlug: 'ogabassey',
          reference: 'AUTH-1',
        }),
      })
    );
  });

  it('ignores duplicate card authorization requests while one is in flight', async () => {
    let resolveAuthorization:
      | ((value: {
          authorization_url: string;
          gateway: 'paystack';
          reference: string;
          success: true;
        }) => void)
      | undefined;
    mockInitializeSavingsAuthorization.mockReturnValue(
      new Promise((resolve) => {
        resolveAuthorization = resolve;
      })
    );
    const { result } = renderHook(() => useStartSavingsSubmit(createInput()));

    let firstAuthorization: Promise<void> = Promise.resolve();
    let duplicateAuthorization: Promise<void> = Promise.resolve();
    act(() => {
      firstAuthorization = result.current.handleAuthorizeSavingsCard();
      duplicateAuthorization = result.current.handleAuthorizeSavingsCard();
    });

    expect(mockInitializeSavingsAuthorization).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAuthorization?.({
        authorization_url: 'https://checkout.paystack.com/auth',
        gateway: 'paystack',
        reference: 'AUTH-1',
        success: true,
      });
      await firstAuthorization;
      await duplicateAuthorization;
    });

    expect(mockRouterPush).toHaveBeenCalledTimes(1);
  });

  it('alerts when Paystack authorization fails', async () => {
    mockInitializeSavingsAuthorization.mockRejectedValue(
      new Error('Paystack unavailable')
    );
    const { result } = renderHook(() => useStartSavingsSubmit(createInput()));

    await act(async () => {
      await result.current.handleAuthorizeSavingsCard();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Unable to add card',
      'Paystack unavailable'
    );
  });

  it('opens wallet funding route with fund action params', () => {
    const { result } = renderHook(() => useStartSavingsSubmit(createInput()));

    act(() => {
      result.current.openWalletFundingScreen();
    });

    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/wallet',
        params: expect.objectContaining({ action: 'fund' }),
      })
    );
  });

  it('uses the provider minimum for small wallet funding top-ups', () => {
    const { result } = renderHook(() =>
      useStartSavingsSubmit(
        createInput({
          contributionValue: 50,
          requiredTopUpAmount: 0,
        })
      )
    );

    act(() => {
      result.current.openWalletFundingScreen();
    });

    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/wallet',
        params: expect.objectContaining({ requiredAmount: '100' }),
      })
    );
  });

  it('navigates back to wallet and opens savings progress', () => {
    const { result } = renderHook(() => useStartSavingsSubmit(createInput()));

    act(() => {
      result.current.goToWallet();
    });

    expect(mockRouterReplace).toHaveBeenCalledWith({
      pathname: '/wallet',
      params: { action: 'savings' },
    });
  });

  it('copies the funding account and alerts the result', async () => {
    const { result } = renderHook(() => useStartSavingsSubmit(createInput()));

    await act(async () => {
      await result.current.handleCopyFundingAccount();
    });

    expect(mockSetClipboardString).toHaveBeenCalledWith('0123456789');
    expect(Alert.alert).toHaveBeenCalledWith(
      'Copied',
      'Account number copied to clipboard.'
    );
  });

  it('does nothing when no funding account is available to copy', async () => {
    const { result } = renderHook(() =>
      useStartSavingsSubmit(createInput({ fundingAccount: null }))
    );

    await act(async () => {
      await result.current.handleCopyFundingAccount();
    });

    expect(mockSetClipboardString).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalledWith('Copied', expect.any(String));
  });

  it('alerts when funding account copy fails', async () => {
    mockSetClipboardString.mockResolvedValue(false);
    const { result } = renderHook(() => useStartSavingsSubmit(createInput()));

    await act(async () => {
      await result.current.handleCopyFundingAccount();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Unable to copy',
      'Unable to copy account number.'
    );
  });

  it('cancels the retained reminder when the deferred contribution completes the goal', async () => {
    mockAddSavingsContribution.mockResolvedValue({
      contributionId: 'contrib-1',
      goalCurrentAmount: 800000,
      goalStatus: 'completed',
      success: true,
      walletBalance: 0,
      walletTransactionId: 'txn-1',
    });
    const input = createInput({
      createdGoalId: 'goal-1',
      effectiveInitialContribution: 800000,
    });
    const { result } = renderHook(() => useStartSavingsSubmit(input));

    await act(async () => {
      await result.current.submitBankTransferContribution();
    });

    expect(mockAddSavingsContribution).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 800000, goalId: 'goal-1' })
    );
    expect(mockCancelSavingsReminderNotification).toHaveBeenCalledWith(
      'goal-1'
    );
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
  });

  it('retains the reminder when the deferred contribution leaves the goal active', async () => {
    const input = createInput({
      createdGoalId: 'goal-1',
      effectiveInitialContribution: 20000,
    });
    const { result } = renderHook(() => useStartSavingsSubmit(input));

    await act(async () => {
      await result.current.submitBankTransferContribution();
    });

    expect(mockAddSavingsContribution).toHaveBeenCalledTimes(1);
    expect(mockCancelSavingsReminderNotification).not.toHaveBeenCalled();
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
  });
});
