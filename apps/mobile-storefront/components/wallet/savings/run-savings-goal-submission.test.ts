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
      variantId: 'variant-1',
      requiresVariantSelection: false,
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

  it('reuses the stored goal key when retrying submission', async () => {
    const input = createInput({ goalIdempotencyKey: 'stored-goal-key' });
    await runSavingsGoalSubmission(input, validation);
    expect(mockCreateSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({ goalIdempotencyKey: 'stored-goal-key' })
    );
  });

  it('requires manual resubmission after an idempotency payload mismatch', async () => {
    mockCreateSavingsGoal.mockRejectedValueOnce(
      new Error('mismatched_goal_idempotency_payload')
    );
    const input = createInput({ goalIdempotencyKey: 'stored-goal-key' });
    await runSavingsGoalSubmission(input, validation);
    expect(mockCreateSavingsGoal).toHaveBeenCalledTimes(1);
    expect(input.setGoalIdempotencyKey).toHaveBeenCalledWith(null);
    expect(input.setFormError).toHaveBeenCalledWith(
      'Your plan details changed. Please submit again to create your plan.'
    );
  });

  it.each([
    'success',
    'failure',
  ])('does not overlay a changed context after late %s', async (outcome) => {
    let finish: (value: { goalId: string; success: boolean }) => void = () =>
      undefined;
    let fail: (error: Error) => void = () => undefined;
    const pending = new Promise<{ goalId: string; success: boolean }>(
      (resolve, reject) => {
        finish = resolve;
        fail = reject;
      }
    );
    mockCreateSavingsGoal.mockReturnValueOnce(pending);
    const input = createInput();
    let current = true;
    const submission = runSavingsGoalSubmission(
      input,
      validation,
      () => current
    );
    current = false;
    if (outcome === 'success') finish({ goalId: 'goal-1', success: true });
    else fail(new Error('Late failure'));
    await submission;
    expect(input.setShowSuccessModal).not.toHaveBeenCalled();
    expect(input.setShowTransferModal).not.toHaveBeenCalled();
    expect(input.setFormError).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
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
        variantId: 'variant-1',
      })
    );
    expect(mockScheduleSavingsReminderNotification).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal-1' })
    );
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
    expect(input.setFormError).toHaveBeenLastCalledWith(null);
  });

  it('submits the selected variant identity instead of a stale route variant', async () => {
    const selectedProduct = {
      ...validation.selectedProduct,
      price: 850000,
      variantId: 'variant-256',
      variantLabel: 'Storage: 256GB',
    };
    const input = createInput({ selectedProduct });

    await runSavingsGoalSubmission(input, {
      formattedStartDate: '2026-05-22',
      selectedProduct,
    });

    expect(mockCreateSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'product-1',
        variantId: 'variant-256',
      })
    );
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

  it('defers the initial contribution for bank transfer and opens plan funding', async () => {
    const setCreatedGoalId = jest.fn();
    const input = createInput({
      deferInitialContribution: true,
      setCreatedGoalId,
    });

    await runSavingsGoalSubmission(input, validation);

    expect(mockCreateSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        initialContributionAmount: 0,
        initialContributionIdempotencyKey: undefined,
      })
    );
    expect(setCreatedGoalId).toHaveBeenCalledWith('goal-1');
    expect(input.setShowTransferModal).toHaveBeenCalledWith(true);
    expect(input.setShowSuccessModal).not.toHaveBeenCalled();
  });

  // Previously asserted that a full-intent deferred transfer cancels the
  // reminder at creation. That treated an UNCONFIRMED intended transfer as
  // complete: the goal is created with initialContributionAmount 0, so a
  // customer who abandons the funding screen is left with an empty active
  // plan and no reminder. The reminder is now retained until a confirmed
  // contribution completes the goal (see submitBankTransferContribution).
  it('schedules reminders when the deferred transfer intends to fully fund the goal', async () => {
    const input = createInput({
      deferInitialContribution: true,
      effectiveInitialContribution: 800000,
      targetValue: 800000,
    });

    await runSavingsGoalSubmission(input, validation);

    expect(mockScheduleSavingsReminderNotification).toHaveBeenCalledTimes(1);
    expect(mockCancelSavingsReminderNotification).not.toHaveBeenCalled();
  });

  it('cancels reminders when an immediate contribution fully funds the goal', async () => {
    const input = createInput({
      effectiveInitialContribution: 800000,
      targetValue: 800000,
    });

    await runSavingsGoalSubmission(input, validation);

    expect(mockCancelSavingsReminderNotification).toHaveBeenCalledWith(
      'goal-1'
    );
    expect(mockScheduleSavingsReminderNotification).not.toHaveBeenCalled();
  });

  it('schedules reminders when the deferred transfer only partly funds the goal', async () => {
    const input = createInput({
      deferInitialContribution: true,
      effectiveInitialContribution: 20000,
      targetValue: 800000,
    });

    await runSavingsGoalSubmission(input, validation);

    expect(mockScheduleSavingsReminderNotification).toHaveBeenCalledTimes(1);
    expect(mockCancelSavingsReminderNotification).not.toHaveBeenCalled();
  });
});
