import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SetStateAction } from 'react';
import type { UseStartSavingsSubmitInput } from './run-savings-goal-submission';
import { runSavingsGoalSubmission } from './run-savings-goal-submission';

const mockCreate =
  jest.fn<
    (...args: unknown[]) => Promise<{ success: boolean; goalId: string }>
  >();
jest.mock('expo-crypto', () => ({ randomUUID: () => 'attempt-generated' }));
jest.mock('@/components/ui/show-app-alert', () => ({
  showAppAlert: jest.fn(),
}));
jest.mock('@/lib/customer-savings', () => ({
  createSavingsGoal: (...args: unknown[]) => mockCreate(...args),
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(),
  scheduleSavingsReminderNotification: jest.fn(),
}));

function fixture() {
  let key: string | null = 'attempt-a';
  const product = {
    id: 'product-a',
    name: 'Synthetic',
    image: '',
    slug: 'synthetic',
    price: 800,
    requiresVariantSelection: false,
    variantId: null,
  };
  const input: UseStartSavingsSubmitInput = {
    contributionValue: 100,
    effectiveInitialContribution: 100,
    frequency: 'daily',
    fundingAccount: null,
    goalIdempotencyKey: 'goal-attempt-a',
    setGoalIdempotencyKey: jest.fn(),
    initialContributionIdempotencyKey: key,
    maturityDate: '2026-12-01',
    preferredDebitTime: '06:20',
    refetch: jest.fn(async () => undefined),
    requiredTopUpAmount: 0,
    selectedPaymentMethodId: null,
    selectedProduct: product,
    setFormError: jest.fn(),
    setInitialContributionIdempotencyKey: (
      update: SetStateAction<string | null>
    ) => {
      key = typeof update === 'function' ? update(key) : update;
    },
    setShowFundingModal: jest.fn(),
    setShowPreviewModal: jest.fn(),
    setShowSuccessModal: jest.fn(),
    setShowTransferModal: jest.fn(),
    sourceMode: 'manual',
    startDate: '2026-09-12',
    targetValue: 800,
  };
  return {
    input,
    validation: {
      formattedStartDate: input.startDate,
      selectedProduct: product,
    },
    getKey: () => key,
    replaceKey: (next: string) => {
      key = next;
    },
  };
}

describe('confirmed submission key retirement', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });
  it.each([
    false,
    true,
  ])('retires only the matching confirmed-success key even for stale UI (newer=%s)', async (newer) => {
    let complete: (value: { success: boolean; goalId: string }) => void = () =>
      undefined;
    mockCreate.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      })
    );
    const test = fixture();
    const pending = runSavingsGoalSubmission(
      test.input,
      test.validation,
      () => false
    );
    if (newer) test.replaceKey('attempt-b');
    complete({ success: true, goalId: 'goal-a' });
    await pending;
    expect(test.getKey()).toBe(newer ? 'attempt-b' : null);
    expect(test.input.setShowSuccessModal).not.toHaveBeenCalled();
  });
  it('keeps an indeterminate request key for retry of the same operation', async () => {
    const test = fixture();
    mockCreate
      .mockRejectedValueOnce(new Error('Synthetic response lost'))
      .mockResolvedValueOnce({ success: true, goalId: 'goal-a' });
    await runSavingsGoalSubmission(test.input, test.validation, () => false);
    expect(test.getKey()).toBe('attempt-a');
    await runSavingsGoalSubmission(test.input, test.validation, () => false);
    expect(mockCreate.mock.calls.map(([request]) => request)).toEqual([
      expect.objectContaining({
        initialContributionIdempotencyKey: 'attempt-a',
      }),
      expect.objectContaining({
        initialContributionIdempotencyKey: 'attempt-a',
      }),
    ]);
    expect(test.getKey()).toBeNull();
  });
  it('does not retire a key for explicit unsuccessful results', async () => {
    const test = fixture();
    mockCreate.mockResolvedValueOnce({ success: false, goalId: '' });
    await runSavingsGoalSubmission(test.input, test.validation, () => false);
    expect(test.getKey()).toBe('attempt-a');
  });
});
