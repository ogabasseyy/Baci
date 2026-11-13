import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  planInterestAnswer,
  resetPlanInterestAnswers,
} from './plan-interest-answers';
import {
  GOAL_WALLET_SETUP_WAIT_MS,
  runSavingsGoalSubmission,
} from './run-savings-goal-submission';
import { createInput } from './run-savings-goal-submission.test-support';

const mockCreateSavingsGoal =
  jest.fn<
    (...args: unknown[]) => Promise<{ goalId: string; success: boolean }>
  >();

jest.mock('expo-crypto', () => ({ randomUUID: () => 'goal-key' }));
jest.mock('@/lib/customer-savings', () => ({
  createSavingsGoal: (...args: unknown[]) => mockCreateSavingsGoal(...args),
}));
const mockScheduleReminder = jest.fn(async () => 'reminder');
jest.mock('@/services/savings-reminder-notifications', () => ({
  scheduleSavingsReminderNotification: () => mockScheduleReminder(),
  cancelSavingsReminderNotification: jest.fn(async () => true),
}));
jest.mock('@/components/ui/show-app-alert', () => ({
  showAppAlert: jest.fn(),
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

beforeEach(() => {
  jest.clearAllMocks();
  resetPlanInterestAnswers();
  mockCreateSavingsGoal.mockResolvedValue({ goalId: 'goal-1', success: true });
});

describe('bugfix: a new PiggyVest plan was left “still being set up”', () => {
  it('starts the plan wallet setup as soon as the plan exists', async () => {
    const start = jest.fn(async () => ({ status: 'pending' }));
    const input = createInput({
      effectiveInitialContribution: 0,
      startGoalWalletSetup: start,
    });
    await runSavingsGoalSubmission(input, validation);
    expect(start).toHaveBeenCalledWith('goal-1');
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
  });

  it('remembers the form answer so a start that never lands can be finished', async () => {
    const input = createInput({
      effectiveInitialContribution: 0,
      interestChoice: false,
      startGoalWalletSetup: jest.fn(async () => {
        throw new Error('offline');
      }),
    });
    await runSavingsGoalSubmission(input, validation);
    expect(planInterestAnswer('goal-1')).toBe(false);
  });

  it('still shows the plan when setup fails to start', async () => {
    const input = createInput({
      effectiveInitialContribution: 0,
      startGoalWalletSetup: jest.fn(async () => {
        throw new Error('provider down');
      }),
    });
    await runSavingsGoalSubmission(input, validation);
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
    expect(input.setFormError).not.toHaveBeenCalledWith(
      expect.stringMatching(/provider down/)
    );
  });

  it('never waits longer than the time box for a slow provider', async () => {
    jest.useFakeTimers();
    try {
      const input = createInput({
        effectiveInitialContribution: 0,
        startGoalWalletSetup: () => new Promise(() => undefined),
      });
      const run = runSavingsGoalSubmission(input, validation);
      await jest.advanceTimersByTimeAsync(GOAL_WALLET_SETUP_WAIT_MS);
      await run;
      expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('bugfix: schedules the plan reminder before waiting on a slow setup', async () => {
    let finish: () => void = () => undefined;
    const input = createInput({
      effectiveInitialContribution: 0,
      startGoalWalletSetup: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    const run = runSavingsGoalSubmission(input, validation);
    // The setup start has not answered, yet the reminder is already set.
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    expect(mockScheduleReminder).toHaveBeenCalledTimes(1);
    expect(input.setShowSuccessModal).not.toHaveBeenCalled();
    finish();
    await run;
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
  });

  it('starts no setup when the plan could not be created', async () => {
    mockCreateSavingsGoal.mockRejectedValue(new Error('nope'));
    const start = jest.fn(async () => undefined);
    await runSavingsGoalSubmission(
      createInput({ startGoalWalletSetup: start }),
      validation
    );
    expect(start).not.toHaveBeenCalled();
  });
});
