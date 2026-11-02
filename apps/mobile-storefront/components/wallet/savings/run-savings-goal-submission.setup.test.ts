import { jest } from '@jest/globals';
import { observePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability-cache';
import { runSavingsGoalSubmission } from './run-savings-goal-submission';
import { createInput } from './use-start-savings-submit.test-utils';

const mockReplace = jest.fn();
const mockCreate = jest.fn(async () => ({
  goalId: 'created-goal',
  success: true,
}));
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'goal-key' }));
jest.mock('@/lib/customer-savings', () => ({
  createSavingsGoal: () => mockCreate(),
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  scheduleSavingsReminderNotification: jest.fn(),
  cancelSavingsReminderNotification: jest.fn(),
}));

it('starts bank account setup instead of exposing confirmation after creating an unfunded primary plan', async () => {
  observePiggyvestPrimaryCapability('primary-merchant', true);
  const input = {
    ...createInput(),
    activeMerchantId: 'primary-merchant',
    deferInitialContribution: true,
    effectiveInitialContribution: 10000,
    requiredTopUpAmount: 10000,
    fundingAccount: null,
    setCreatedGoalId: jest.fn(),
  };

  await runSavingsGoalSubmission(input, {
    formattedStartDate: input.startDate,
    selectedProduct: input.selectedProduct,
  });

  expect(mockReplace).toHaveBeenCalledWith({
    pathname: '/wallet',
    params: expect.objectContaining({
      action: 'bank-transfer',
      requiredAmount: '10000',
      returnTo:
        '/wallet?action=savings&savingsGoalId=created-goal&savingsAmount=10000',
    }),
  });
  expect(input.setShowTransferModal).not.toHaveBeenCalledWith(true);
  expect(input.setShowSuccessModal).not.toHaveBeenCalledWith(true);
  expect(input.setCreatedGoalId).toHaveBeenCalledWith('created-goal');
});
