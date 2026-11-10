import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { createSavingsGoal } from '@/lib/customer-savings';
import {
  PRIMARY_BALANCE_CHECK_FAILED_MESSAGE,
  PRIMARY_HEAD_START_SHORT_MESSAGE,
  readFreshPrimaryBalance,
} from './start-savings-wallet-balance';
import { useStartSavingsSubmit } from './use-start-savings-submit';
import { createInput } from './use-start-savings-submit.test-utils';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'op-uuid-1' }));
jest.mock('@/lib/customer-savings', () => ({
  addSavingsContribution: jest.fn(),
  createSavingsGoal: jest.fn(async () => ({
    success: true,
    goalId: 'goal-1',
  })),
  initializeSavingsAuthorization: jest.fn(),
}));
jest.mock('./start-savings-wallet-balance', () => ({
  ...jest.requireActual<object>('./start-savings-wallet-balance'),
  readFreshPrimaryBalance: jest.fn(),
}));
jest.mock('@/lib/clipboard', () => ({ setClipboardString: jest.fn() }));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(async () => true),
  scheduleSavingsReminderNotification: jest.fn(async () => 'reminder-1'),
}));

const readBalance = jest.mocked(readFreshPrimaryBalance);
const primaryOptions = {
  deferInitialContribution: true,
  continueInWallet: true,
  confirmPrimaryBalance: true,
};

describe('PiggyVest head start balance check at submit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('creates the plan once a fresh balance covers the head start', async () => {
    readBalance.mockResolvedValueOnce(20000);
    const input = createInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    await act(async () => {
      await result.current.submitSavingsGoal(primaryOptions);
    });
    // The screen's resolved merchant, including the configured fallback.
    expect(readBalance).toHaveBeenCalledWith('merchant-1');
    expect(createSavingsGoal).toHaveBeenCalledWith(
      expect.objectContaining({ initialContributionAmount: 0 })
    );
    // The exact route contract the wallet screen reads to prefill the sheet.
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/wallet',
      params: {
        action: 'savings',
        savingsGoalId: 'goal-1',
        savingsAmount: '20000',
      },
    });
  });

  it('never opens the wallet for a plan that does not continue there', async () => {
    const input = createInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    await act(async () => {
      await result.current.submitSavingsGoal({
        deferInitialContribution: true,
      });
    });
    expect(readBalance).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(input.setShowTransferModal).toHaveBeenCalledWith(true);
  });

  it.each([
    ['is short', 19999, PRIMARY_HEAD_START_SHORT_MESSAGE],
    ['cannot be confirmed', null, PRIMARY_BALANCE_CHECK_FAILED_MESSAGE],
  ])('creates nothing when the balance %s', async (_label, balance, message) => {
    readBalance.mockResolvedValueOnce(balance);
    const input = createInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    await act(async () => {
      await result.current.submitSavingsGoal(primaryOptions);
    });
    expect(createSavingsGoal).not.toHaveBeenCalled();
    expect(input.setFormError).toHaveBeenCalledWith(message);
    expect(result.current.isSubmitting).toBe(false);
  });

  it('drops the submission when the plan is edited during the check', async () => {
    let answer: (value: number) => void = () => undefined;
    readBalance.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const input = createInput();
    const { result, rerender } = renderHook(
      (props: ReturnType<typeof createInput>) => useStartSavingsSubmit(props),
      { initialProps: input }
    );
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.submitSavingsGoal(primaryOptions);
    });
    // A second tap while the check runs starts nothing new.
    await act(async () => {
      await result.current.submitSavingsGoal(primaryOptions);
    });
    expect(readBalance).toHaveBeenCalledTimes(1);
    rerender({ ...input, targetValue: 900000 });
    await act(async () => {
      answer(50000);
      await pending;
    });
    expect(createSavingsGoal).not.toHaveBeenCalled();
    expect(input.setFormError).not.toHaveBeenCalled();
  });
});
