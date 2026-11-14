import { createSavingsGoal } from '@/lib/customer-savings';
import { runSavingsGoalSubmission } from './run-savings-goal-submission';
import { createInput } from './use-start-savings-submit.test-utils';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'initial-key-1' }));
jest.mock('@/lib/customer-savings', () => ({
  createSavingsGoal: jest.fn(async () => ({ goalId: 'goal-1', success: true })),
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(async () => true),
  scheduleSavingsReminderNotification: jest.fn(async () => 'reminder-1'),
}));

// Goal creation is unchanged with PiggyVest off: it mints the first
// contribution key and never touches the rail, which belongs to the transfer.
describe('server keeps PiggyVest off', () => {
  it('creates the goal with a fresh key and records no rail', async () => {
    const input = createInput({ setInitialContributionRail: jest.fn() });
    await runSavingsGoalSubmission(
      input as never,
      {
        formattedStartDate: '2026-05-22',
        selectedProduct: input.selectedProduct,
      } as never
    );
    expect(createSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        initialContributionIdempotencyKey: 'initial-key-1',
      })
    );
    expect(input.setInitialContributionRail).not.toHaveBeenCalled();
  });
});
