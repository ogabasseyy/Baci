import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import {
  PLAN_CREATED_HEAD_START_PENDING,
  runSavingsGoalSubmission,
} from './run-savings-goal-submission';
import {
  createInput,
  loadedWith,
  validation,
} from './run-savings-goal-submission.test-support';

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

// The PiggyVest head start: the plan is created without it, then handed to
// the wallet only once the reloaded wallet holds the new plan.
describe('runSavingsGoalSubmission PiggyVest head-start hand-off', () => {
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

  it('hands a deferred PiggyVest head start to the wallet instead of the transfer sheet', async () => {
    const setCreatedGoalId = jest.fn();
    const onContinueInWallet = jest.fn();
    const input = createInput({
      deferInitialContribution: true,
      effectiveInitialContribution: 10000,
      onContinueInWallet,
      refetch: jest.fn(async () => loadedWith('goal-1')),
      setCreatedGoalId,
      submittingUserId: 'user-1',
    });

    await runSavingsGoalSubmission(input, validation);

    // The plan is created for the submitting account only, without
    // debiting the legacy wallet...
    expect(mockCreateSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedUserId: 'user-1',
        initialContributionAmount: 0,
      })
    );
    // ...and the head start moves from the wallet's Add to savings sheet.
    expect(onContinueInWallet).toHaveBeenCalledWith('goal-1', 10000);
    // The new goal is loaded into the wallet data before the hand-off.
    expect(input.refetch).toHaveBeenCalled();
    const refetchOrder = jest.mocked(input.refetch).mock.invocationCallOrder[0];
    const handOffOrder = onContinueInWallet.mock.invocationCallOrder[0];
    expect(refetchOrder).toBeLessThan(handOffOrder ?? 0);
    expect(input.setShowTransferModal).not.toHaveBeenCalledWith(true);
    expect(input.setShowSuccessModal).not.toHaveBeenCalled();
    expect(setCreatedGoalId).not.toHaveBeenCalled();
  });

  it.each([
    ['resolves with an error', { isError: true, data: undefined }],
    ['has not loaded the new plan yet', loadedWith('older-goal')],
  ])('never prefills the head start when the reload %s', async (_l, outcome) => {
    const onContinueInWallet = jest.fn();
    const input = createInput({
      deferInitialContribution: true,
      effectiveInitialContribution: 10000,
      onContinueInWallet,
      refetch: jest.fn(async () => outcome),
    });

    await runSavingsGoalSubmission(input, validation);

    expect(onContinueInWallet).not.toHaveBeenCalled();
    expect(input.setFormError).toHaveBeenLastCalledWith(
      PLAN_CREATED_HEAD_START_PENDING
    );
    // Said where the customer will see it, not only in the form.
    expect(Alert.alert).toHaveBeenCalledWith(
      'Plan created',
      PLAN_CREATED_HEAD_START_PENDING
    );
  });

  it('never prefills the head start on another plan when the reload fails', async () => {
    const onContinueInWallet = jest.fn();
    const input = createInput({
      deferInitialContribution: true,
      effectiveInitialContribution: 10000,
      onContinueInWallet,
      refetch: jest.fn(async () => {
        throw new Error('offline');
      }),
    });

    await runSavingsGoalSubmission(input, validation);

    expect(mockCreateSavingsGoal).toHaveBeenCalled();
    expect(onContinueInWallet).not.toHaveBeenCalled();
    expect(input.setFormError).toHaveBeenLastCalledWith(
      PLAN_CREATED_HEAD_START_PENDING
    );
    // Said where the customer will see it, not only in the form.
    expect(Alert.alert).toHaveBeenCalledWith(
      'Plan created',
      PLAN_CREATED_HEAD_START_PENDING
    );
  });
});
