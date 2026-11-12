import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { createSavingsGoal } from '@/lib/customer-savings';
import { useAuthStore } from '@/stores/auth-store';
import {
  PRIMARY_BALANCE_CHECK_FAILED_MESSAGE,
  PRIMARY_HEAD_START_ABOVE_TARGET_MESSAGE,
  PRIMARY_HEAD_START_SHORT_MESSAGE,
  PRIMARY_HEAD_START_WHOLE_NAIRA_MESSAGE,
  readFreshPrimaryBalanceKobo,
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
  readFreshPrimaryBalanceKobo: jest.fn(),
}));
jest.mock('@/lib/clipboard', () => ({ setClipboardString: jest.fn() }));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(async () => true),
  scheduleSavingsReminderNotification: jest.fn(async () => 'reminder-1'),
}));

const readBalance = jest.mocked(readFreshPrimaryBalanceKobo);
const primaryOptions = {
  deferInitialContribution: true,
  continueInWallet: true,
  confirmPrimaryBalance: true,
};

describe('PiggyVest head start balance check at submit', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'user-a' } } as never);
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('creates the plan once a fresh balance covers the head start', async () => {
    readBalance.mockResolvedValueOnce(2_000_000);
    // The reload brings in the new plan, so the hand-off can proceed.
    const input = createInput({
      refetch: jest.fn(async () => ({
        isError: false,
        data: { wallet: { savings_goals: [{ id: 'goal-1' }] } },
      })),
    });
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
    ['is short by a kobo', 1_999_999, PRIMARY_HEAD_START_SHORT_MESSAGE],
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

  it.each([
    0.004, 0.009,
  ])('refuses a sub-naira head start of %p instead of handing over ₦0', async (amount) => {
    const input = createInput({ effectiveInitialContribution: amount });
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    await act(async () => {
      await result.current.submitSavingsGoal(primaryOptions);
    });
    expect(createSavingsGoal).not.toHaveBeenCalled();
    expect(input.setFormError).toHaveBeenCalledWith(
      PRIMARY_HEAD_START_WHOLE_NAIRA_MESSAGE
    );
  });

  it('refuses a head start above the target even on a direct submit', async () => {
    const input = createInput({
      effectiveInitialContribution: 900000,
      targetValue: 800000,
    });
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    await act(async () => {
      await result.current.submitSavingsGoal(primaryOptions);
    });
    expect(readBalance).not.toHaveBeenCalled();
    expect(createSavingsGoal).not.toHaveBeenCalled();
    expect(input.setFormError).toHaveBeenCalledWith(
      PRIMARY_HEAD_START_ABOVE_TARGET_MESSAGE
    );
    expect(result.current.isSubmitting).toBe(false);
  });

  it('releases the submit lock when the balance read throws', async () => {
    readBalance.mockRejectedValueOnce(new Error('boom'));
    const input = createInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    await act(async () => {
      await result.current.submitSavingsGoal(primaryOptions);
    });
    expect(input.setFormError).toHaveBeenCalledWith(
      PRIMARY_BALANCE_CHECK_FAILED_MESSAGE
    );
    expect(result.current.isSubmitting).toBe(false);
    // A later attempt runs again instead of hitting a stuck lock.
    readBalance.mockResolvedValueOnce(null);
    await act(async () => {
      await result.current.submitSavingsGoal(primaryOptions);
    });
    expect(readBalance).toHaveBeenCalledTimes(2);
  });

  it('drops the submission when another account signs in during the check', async () => {
    useAuthStore.setState({ user: { id: 'user-a' } } as never);
    let answer: (value: number) => void = () => undefined;
    readBalance.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const input = createInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.submitSavingsGoal(primaryOptions);
    });
    act(() => {
      useAuthStore.setState({ user: { id: 'user-b' } } as never);
    });
    await act(async () => {
      answer(5_000_000);
      await pending;
    });
    expect(createSavingsGoal).not.toHaveBeenCalled();
    expect(input.setFormError).not.toHaveBeenCalled();
    useAuthStore.setState({ user: null } as never);
  });

  it('never opens the wallet for a new account after the plan is created', async () => {
    useAuthStore.setState({ user: { id: 'user-a' } } as never);
    readBalance.mockResolvedValueOnce(2_000_000);
    let reloaded: (value: unknown) => void = () => undefined;
    const input = createInput({
      refetch: jest.fn(
        () =>
          new Promise((resolve) => {
            reloaded = resolve;
          })
      ),
    });
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.submitSavingsGoal(primaryOptions);
      await Promise.resolve();
    });
    // The plan exists and the wallet reload is running; the account switches.
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(createSavingsGoal).toHaveBeenCalled();
    act(() => {
      useAuthStore.setState({ user: { id: 'user-b' } } as never);
    });
    await act(async () => {
      reloaded({
        isError: false,
        data: { wallet: { savings_goals: [{ id: 'goal-1' }] } },
      });
      await pending;
    });
    expect(router.replace).not.toHaveBeenCalled();
    useAuthStore.setState({ user: null } as never);
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
      answer(5_000_000);
      await pending;
    });
    expect(createSavingsGoal).not.toHaveBeenCalled();
    expect(input.setFormError).not.toHaveBeenCalled();
  });
});
