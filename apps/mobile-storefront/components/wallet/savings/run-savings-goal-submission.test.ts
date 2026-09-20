import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import type { UseStartSavingsSubmitInput } from './run-savings-goal-submission';
import { runSavingsGoalSubmission } from './run-savings-goal-submission';

const mockCreateSavingsGoal =
  jest.fn<
    (...args: unknown[]) => Promise<{ goalId: string; success: boolean }>
  >();
const mockRandomUUID = jest.fn();
const mockScheduleSavingsReminderNotification =
  jest.fn<(...args: unknown[]) => Promise<string | null>>();
const mockCancelSavingsReminderNotification =
  jest.fn<(...args: unknown[]) => Promise<boolean>>();

jest.mock('expo-crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}));

jest.mock('@/lib/customer-savings', () => ({
  createSavingsGoal: (...args: unknown[]) => mockCreateSavingsGoal(...args),
}));

jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: (...args: unknown[]) =>
    mockCancelSavingsReminderNotification(...args),
  scheduleSavingsReminderNotification: (...args: unknown[]) =>
    mockScheduleSavingsReminderNotification(...args),
}));

function createInput(overrides = {}): UseStartSavingsSubmitInput {
  return {
    activeMerchantId: 'merchant-1',
    activeMerchantSlug: 'ogabassey',
    contributionValue: 20000,
    effectiveInitialContribution: 20000,
    frequency: 'daily' as const,
    fundingAccount: { account_number: '0123456789' },
    initialContributionIdempotencyKey: null,
    maturityDate: '2026-06-30',
    normalizedVariantId: undefined,
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
    ...overrides,
  };
}

const validation = {
  formattedStartDate: '2026-05-22',
  selectedProduct: {
    id: 'product-1',
    image: 'https://example.com/iphone.jpg',
    name: 'iPhone 13 Pro Max',
    price: 800000,
    slug: 'iphone-13-pro-max',
  },
};

describe('runSavingsGoalSubmission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockRandomUUID.mockReturnValue('initial-key-1');
    mockCreateSavingsGoal.mockResolvedValue({
      goalId: 'goal-1',
      success: true,
    });
    mockCancelSavingsReminderNotification.mockResolvedValue(true);
    mockScheduleSavingsReminderNotification.mockResolvedValue('reminder-1');
  });

  it('creates a manual savings goal, schedules the reminder and opens the success modal', async () => {
    const input = createInput();

    await runSavingsGoalSubmission(input, validation);

    expect(input.setInitialContributionIdempotencyKey).toHaveBeenCalledWith(
      'initial-key-1'
    );
    expect(mockCreateSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        initialContributionIdempotencyKey: 'initial-key-1',
        productId: 'product-1',
        sourceMode: 'manual',
        startDate: '2026-05-22',
      })
    );
    expect(mockScheduleSavingsReminderNotification).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal-1' })
    );
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
    expect(input.setFormError).toHaveBeenLastCalledWith(null);
  });

  it('surfaces an error when savings goal creation returns success false', async () => {
    mockCreateSavingsGoal.mockResolvedValue({
      goalId: 'goal-1',
      success: false,
    });
    const input = createInput();

    await runSavingsGoalSubmission(input, validation);

    expect(input.setFormError).toHaveBeenCalledWith(
      'Unable to create savings plan.'
    );
    expect(Alert.alert).toHaveBeenCalledWith(
      'Unable to create plan',
      'Unable to create savings plan.'
    );
    expect(input.setShowSuccessModal).not.toHaveBeenCalled();
  });

  it('opens the transfer modal for insufficient wallet balance errors', async () => {
    const error = Object.assign(new Error('Insufficient wallet balance'), {
      code: 'INSUFFICIENT_WALLET_BALANCE',
    });
    mockCreateSavingsGoal.mockRejectedValue(error);
    const input = createInput();

    await runSavingsGoalSubmission(input, validation);

    expect(input.setShowTransferModal).toHaveBeenCalledWith(true);
    expect(Alert.alert).not.toHaveBeenCalledWith(
      'Unable to create plan',
      expect.any(String)
    );
  });

  it('falls through to the generic error for insufficient balance without a funding account', async () => {
    const error = Object.assign(new Error('Insufficient wallet balance'), {
      code: 'INSUFFICIENT_WALLET_BALANCE',
    });
    mockCreateSavingsGoal.mockRejectedValue(error);
    const input = createInput({ fundingAccount: null });

    await runSavingsGoalSubmission(input, validation);

    expect(input.setShowTransferModal).not.toHaveBeenCalledWith(true);
    expect(input.setFormError).toHaveBeenCalledWith(
      'Insufficient wallet balance'
    );
    expect(Alert.alert).toHaveBeenCalledWith(
      'Unable to create plan',
      'Insufficient wallet balance'
    );
  });

  it('keeps success visible when wallet data refresh fails after creation', async () => {
    const input = createInput({
      refetch: jest.fn(() => Promise.reject(new Error('Refresh failed'))),
    });

    await runSavingsGoalSubmission(input, validation);

    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
    expect(input.setFormError).toHaveBeenLastCalledWith(
      'Plan created but unable to refresh wallet data.'
    );
  });
});
