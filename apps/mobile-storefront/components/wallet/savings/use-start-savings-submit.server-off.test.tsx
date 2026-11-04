import { act, renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';
import { addSavingsContribution } from '@/lib/customer-savings';
import { addPiggyvestPrimarySavingsContribution } from '@/lib/piggyvest-primary-savings';
import { checkPiggyvestPrimarySavingsStatus } from '@/lib/piggyvest-primary-savings-status';
import { SERVER_OFF_MERCHANT_ID } from '@/test-support/piggyvest-server-off.test-support';
import { useStartSavingsSubmit } from './use-start-savings-submit';
import { createInput } from './use-start-savings-submit.test-utils';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));
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
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(addSavingsContribution)
    .mockResolvedValue({ goalStatus: 'active' } as never);
});

// A merchant the server keeps off is not a primary merchant: the first
// contribution takes the legacy rail and funding opens the wallet top-up.
describe('server keeps PiggyVest off', () => {
  it('records the first contribution on the legacy rail only', async () => {
    const input = createInput({
      activeMerchantId: SERVER_OFF_MERCHANT_ID,
      createdGoalId: 'goal-1',
    });
    const { result } = renderHook(() => useStartSavingsSubmit(input as never));
    await act(async () => {
      await result.current.submitBankTransferContribution();
    });
    expect(addSavingsContribution).toHaveBeenCalledTimes(1);
    expect(addPiggyvestPrimarySavingsContribution).not.toHaveBeenCalled();
    expect(checkPiggyvestPrimarySavingsStatus).not.toHaveBeenCalled();
  });

  it('opens the wallet top-up screen for funding', () => {
    const input = createInput({ activeMerchantId: SERVER_OFF_MERCHANT_ID });
    const { result } = renderHook(() => useStartSavingsSubmit(input as never));
    result.current.openWalletFundingScreen();
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/wallet',
        params: expect.objectContaining({
          action: 'fund',
          returnTo: '/wallet/savings/start',
        }),
      })
    );
  });
});
