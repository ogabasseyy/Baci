import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  runSavingsGoalSubmission,
  type UseStartSavingsSubmitInput,
} from './run-savings-goal-submission';

const mockCreateSavingsGoal =
  jest.fn<
    (...args: unknown[]) => Promise<{ goalId: string; success: boolean }>
  >();
const mockScheduleReminder = jest.fn<(...args: unknown[]) => Promise<string>>();
const mockCancelReminder = jest.fn<(...args: unknown[]) => Promise<boolean>>();

jest.mock('expo-crypto', () => ({ randomUUID: () => 'goal-key' }));
jest.mock('@/lib/customer-savings', () => ({
  createSavingsGoal: (...args: unknown[]) => mockCreateSavingsGoal(...args),
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  scheduleSavingsReminderNotification: (...args: unknown[]) =>
    mockScheduleReminder(...args),
  cancelSavingsReminderNotification: (...args: unknown[]) =>
    mockCancelReminder(...args),
}));

const validation = {
  formattedStartDate: '2026-05-22',
  selectedProduct: {
    id: 'product-1',
    image: 'https://example.com/iphone.jpg',
    name: 'iPhone 13 Pro Max',
    price: 800000,
    slug: 'iphone-13-pro-max',
    variantId: 'variant-1',
    requiresVariantSelection: false,
  },
};

function createInput(
  overrides: Partial<UseStartSavingsSubmitInput> = {}
): UseStartSavingsSubmitInput {
  return {
    activeMerchantId: 'merchant-1',
    activeMerchantSlug: 'ogabassey',
    contributionValue: 20000,
    effectiveInitialContribution: 800000,
    frequency: 'daily',
    fundingAccount: { account_number: '0123456789' },
    goalIdempotencyKey: null,
    setGoalIdempotencyKey: jest.fn(),
    initialContributionIdempotencyKey: null,
    setInitialContributionIdempotencyKey: jest.fn(),
    maturityDate: '2026-06-30',
    preferredDebitTime: '06:20',
    refetch: jest.fn(async () => undefined),
    requiredTopUpAmount: 800000,
    selectedPaymentMethodId: null,
    selectedProduct: validation.selectedProduct,
    setCreatedGoalId: jest.fn(),
    setFormError: jest.fn(),
    setShowFundingModal: jest.fn(),
    setShowPreviewModal: jest.fn(),
    setShowSuccessModal: jest.fn(),
    setShowTransferModal: jest.fn(),
    sourceMode: 'manual',
    startDate: validation.formattedStartDate,
    targetValue: 800000,
    ...overrides,
  };
}

describe('savings submission reminder funding boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateSavingsGoal.mockResolvedValue({
      goalId: 'goal-1',
      success: true,
    });
    mockScheduleReminder.mockResolvedValue('reminder-1');
    mockCancelReminder.mockResolvedValue(true);
  });

  it.each([
    800000, 20000,
  ])('keeps a reminder for unconfirmed deferred funding of %i, even when the intended amount meets the target', async (effectiveInitialContribution) => {
    const input = createInput({
      deferInitialContribution: true,
      effectiveInitialContribution,
    });

    await runSavingsGoalSubmission(input, validation);

    expect(mockCreateSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        initialContributionAmount: 0,
        initialContributionIdempotencyKey: undefined,
      })
    );
    expect(mockScheduleReminder).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal-1' })
    );
    expect(mockCancelReminder).not.toHaveBeenCalled();
    expect(input.setCreatedGoalId).toHaveBeenCalledWith('goal-1');
    expect(input.setShowTransferModal).toHaveBeenCalledWith(true);
    expect(input.setShowSuccessModal).not.toHaveBeenCalled();
  });

  it('cancels the reminder after successful nondeferred full initial funding', async () => {
    const input = createInput({ deferInitialContribution: false });

    await runSavingsGoalSubmission(input, validation);

    expect(mockCreateSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({ initialContributionAmount: 800000 })
    );
    expect(mockCancelReminder).toHaveBeenCalledWith('goal-1');
    expect(mockScheduleReminder).not.toHaveBeenCalled();
  });
});
