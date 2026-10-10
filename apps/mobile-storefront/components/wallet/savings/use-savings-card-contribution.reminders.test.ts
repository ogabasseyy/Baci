import { act, renderHook } from '@testing-library/react-native';
import { readSavingsCardContributionSnapshot } from '@/lib/savings-card-contribution-snapshot';
import {
  getSavingsCardContributionOptions,
  getSavingsCardContributionStatus,
} from '@/lib/savings-card-contributions';
import { cancelSavingsReminderNotification } from '@/services/savings-reminder-notifications';
import { useSavingsCardContribution } from './use-savings-card-contribution';

jest.mock('@/lib/savings-card-contribution-snapshot', () => ({
  readSavingsCardContributionSnapshot: jest.fn(),
}));
jest.mock('@/lib/savings-card-contributions', () => ({
  getSavingsCardContributionOptions: jest.fn(),
  getSavingsCardContributionStatus: jest.fn(),
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(),
}));
const saved = {
  goalId: 'goal-1',
  savedMethodId: 'method-1',
  amountKobo: 10000,
  idempotencyKey: 'key-1',
  consent: {
    version: 'prefunded-card-v1' as const,
    oneTimeCharge: true as const,
  },
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readSavingsCardContributionSnapshot).mockResolvedValue(saved);
  jest.mocked(getSavingsCardContributionOptions).mockResolvedValue({
    goalId: saved.goalId,
    enabled: true,
    newCardEnabled: false,
    currency: 'NGN',
    maximumAmountKobo: 500000,
    savedMethods: [],
  });
  jest.mocked(cancelSavingsReminderNotification).mockResolvedValue(true);
});
it.each([
  ['completed', 100, true],
  ['completed', 101, false],
  ['pending', 100, false],
] as const)('wires restored status and remaining naira into reminder cleanup: %s/%s', async (status, remainingAmount, cancels) => {
  jest.mocked(getSavingsCardContributionStatus).mockResolvedValue({
    goalId: saved.goalId,
    operationId: 'operation-1',
    amountKobo: 10000,
    currency: 'NGN',
    status,
  });
  const onRefreshWallet = jest.fn(async () => {
    unmount();
  });
  const { unmount } = renderHook(() =>
    useSavingsCardContribution({
      amount: '100',
      goalId: saved.goalId,
      merchantId: 'merchant-1',
      userId: 'customer-1',
      onAmountChange: jest.fn(),
      remainingAmount,
      onRefreshWallet,
    })
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(cancelSavingsReminderNotification).toHaveBeenCalledTimes(
    cancels ? 1 : 0
  );
  if (cancels) {
    expect(cancelSavingsReminderNotification).toHaveBeenCalledWith(
      saved.goalId
    );
    expect(
      jest.mocked(cancelSavingsReminderNotification).mock.invocationCallOrder[0]
    ).toBeLessThan(onRefreshWallet.mock.invocationCallOrder[0]);
  }
  unmount();
});
