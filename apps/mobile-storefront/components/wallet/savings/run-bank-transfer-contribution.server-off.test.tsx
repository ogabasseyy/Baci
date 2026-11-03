import { addSavingsContribution } from '@/lib/customer-savings';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { addPiggyvestPrimarySavingsContribution } from '@/lib/piggyvest-primary-savings';
import { checkPiggyvestPrimarySavingsStatus } from '@/lib/piggyvest-primary-savings-status';
import { runBankTransferContribution } from './run-bank-transfer-contribution';
import { createInput } from './use-start-savings-submit.test-utils';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'fresh-op' }));
jest.mock('@/components/ui/show-app-alert', () => ({
  showAppAlert: jest.fn(),
}));
jest.mock('@/lib/customer-savings', () => ({
  addSavingsContribution: jest.fn(),
}));
jest.mock('@/lib/piggyvest-primary-savings', () => ({
  addPiggyvestPrimarySavingsContribution: jest.fn(),
}));
jest.mock('@/lib/piggyvest-primary-savings-status', () => ({
  checkPiggyvestPrimarySavingsStatus: jest.fn(),
}));
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: jest.fn(),
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isPiggyvestPrimaryMerchant).mockReturnValue(false);
  jest
    .mocked(addSavingsContribution)
    .mockResolvedValue({ goalStatus: 'active' } as never);
});

// With PiggyVest off for the merchant, the first contribution is the
// production legacy transfer: no primary call and no primary status read.
describe('server keeps PiggyVest off', () => {
  it('submits on the legacy rail with a fresh id', async () => {
    const railRef = { current: null };
    const input = createInput({ createdGoalId: 'goal-1' });
    await runBankTransferContribution(input as never, 'goal-1', 20000, {
      isMounted: () => true,
      railRef: railRef as never,
    });
    expect(addSavingsContribution).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal-1', idempotencyKey: 'fresh-op' })
    );
    expect(addPiggyvestPrimarySavingsContribution).not.toHaveBeenCalled();
    expect(checkPiggyvestPrimarySavingsStatus).not.toHaveBeenCalled();
    expect(railRef.current).toEqual({
      operationId: 'fresh-op',
      rail: 'legacy',
    });
    expect(input.setShowSuccessModal).toHaveBeenCalledWith(true);
  });

  it('keeps a primary-bound id waiting instead of moving it to legacy', async () => {
    jest
      .mocked(checkPiggyvestPrimarySavingsStatus)
      .mockResolvedValue({ status: 'pending' } as never);
    const input = createInput({
      createdGoalId: 'goal-1',
      initialContributionIdempotencyKey: 'op-1',
    });
    await runBankTransferContribution(input as never, 'goal-1', 20000, {
      isMounted: () => true,
      railRef: { current: { operationId: 'op-1', rail: 'primary' } } as never,
    });
    expect(addSavingsContribution).not.toHaveBeenCalled();
    expect(addPiggyvestPrimarySavingsContribution).not.toHaveBeenCalled();
  });
});
