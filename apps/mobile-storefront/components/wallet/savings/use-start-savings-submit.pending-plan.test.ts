import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { createSavingsGoal } from '@/lib/customer-savings';
import { useAuthStore } from '@/stores/auth-store';
import {
  PLAN_ALREADY_CREATED_MESSAGE,
  SIGN_IN_TO_START_SAVINGS_MESSAGE,
} from './hand-off-to-wallet';
import { readFreshPrimaryBalanceKobo } from './start-savings-wallet-balance';
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

const loaded = {
  isError: false,
  data: { wallet: { savings_goals: [{ id: 'goal-1' }] } },
};

describe('a created plan whose head start has not moved yet', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'user-a' } } as never);
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    readBalance.mockResolvedValue(2_000_000);
  });

  /** Submits once with a reload that never holds the new plan. */
  async function createStalledPlan(overrides = {}) {
    const refetch = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({ isError: true, data: undefined })
      .mockResolvedValue(loaded);
    const input = createInput({ refetch, ...overrides });
    const view = renderHook(
      (props: ReturnType<typeof createInput>) => useStartSavingsSubmit(props),
      { initialProps: input }
    );
    await act(async () => {
      await view.result.current.submitSavingsGoal(primaryOptions);
    });
    expect(createSavingsGoal).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    return { ...view, input };
  }

  it('retries the hand-off for the created plan instead of creating another', async () => {
    const refetch = jest
      .fn<() => Promise<unknown>>()
      // First reload has not picked the new plan up yet.
      .mockResolvedValueOnce({ isError: true, data: undefined })
      .mockResolvedValue({
        isError: false,
        data: { wallet: { savings_goals: [{ id: 'goal-1' }] } },
      });
    const input = createInput({ refetch });
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    await act(async () => {
      await result.current.submitSavingsGoal(primaryOptions);
    });
    expect(createSavingsGoal).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    // The customer submits again: the same plan is handed over.
    await act(async () => {
      await result.current.submitSavingsGoal(primaryOptions);
    });
    expect(createSavingsGoal).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ savingsGoalId: 'goal-1' }),
      })
    );
    readBalance.mockReset();
  });

  it('keeps the created plan when the form is edited during the reload', async () => {
    let reloaded: (value: unknown) => void = () => undefined;
    const refetch = jest.fn(
      () =>
        new Promise((resolve) => {
          reloaded = resolve;
        })
    );
    const input = createInput({ refetch });
    const { result, rerender } = renderHook(
      (props: ReturnType<typeof createInput>) => useStartSavingsSubmit(props),
      { initialProps: input }
    );
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.submitSavingsGoal(primaryOptions);
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(createSavingsGoal).toHaveBeenCalledTimes(1);
    // The customer edits the plan while the wallet reload is still running.
    const edited = { ...input, effectiveInitialContribution: 30000 };
    rerender(edited);
    await act(async () => {
      reloaded(loaded);
      await pending;
    });
    expect(router.replace).not.toHaveBeenCalled();
    // Submitting the edited form must not create a second plan.
    await act(async () => {
      await result.current.submitSavingsGoal({
        deferInitialContribution: true,
      });
    });
    expect(createSavingsGoal).toHaveBeenCalledTimes(1);
    expect(edited.setFormError).toHaveBeenLastCalledWith(
      PLAN_ALREADY_CREATED_MESSAGE
    );
  });

  it('never funds the created plan with an edited product or amount', async () => {
    const { result, rerender, input } = await createStalledPlan();
    rerender({ ...input, effectiveInitialContribution: 30000 });
    await act(async () => {
      await result.current.submitSavingsGoal(primaryOptions);
    });
    expect(createSavingsGoal).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    expect(input.setFormError).toHaveBeenLastCalledWith(
      PLAN_ALREADY_CREATED_MESSAGE
    );
  });

  it.each([
    ['bank transfer', { deferInitialContribution: true }],
    ['no head start', undefined],
  ])('never creates a second plan after switching to %s', async (_l, options) => {
    const { result, input } = await createStalledPlan();
    await act(async () => {
      await result.current.submitSavingsGoal(options);
    });
    expect(createSavingsGoal).toHaveBeenCalledTimes(1);
    expect(input.setFormError).toHaveBeenLastCalledWith(
      PLAN_ALREADY_CREATED_MESSAGE
    );
  });

  it('creates nothing when no account is signed in', async () => {
    useAuthStore.setState({ user: null } as never);
    const input = createInput();
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    await act(async () => {
      await result.current.submitSavingsGoal(primaryOptions);
    });
    expect(createSavingsGoal).not.toHaveBeenCalled();
    expect(readBalance).not.toHaveBeenCalled();
    expect(input.setFormError).toHaveBeenLastCalledWith(
      SIGN_IN_TO_START_SAVINGS_MESSAGE
    );
    expect(result.current.isSubmitting).toBe(false);
  });
});
