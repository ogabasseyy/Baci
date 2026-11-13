import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { createSavingsGoal } from '@/lib/customer-savings';
import { useAuthStore } from '@/stores/auth-store';
import { PLAN_CREATED_OPEN_WALLET_MESSAGE } from './hand-off-to-wallet';
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
jest.mock('@/lib/clipboard', () => ({ setClipboardString: jest.fn() }));
jest.mock('@/services/savings-reminder-notifications', () => ({
  cancelSavingsReminderNotification: jest.fn(async () => true),
  scheduleSavingsReminderNotification: jest.fn(async () => 'reminder-1'),
}));

const signIn = (id: string) =>
  act(() => {
    useAuthStore.setState({ user: { id } } as never);
  });

beforeEach(() => {
  useAuthStore.setState({ user: { id: 'user-a' } } as never);
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

describe('bugfix: a plan created while setup was still running was created again', () => {
  it('refuses the unchanged draft after switching account away and back', async () => {
    // Arrange: the plan is created, then setup stays in flight.
    let finishSetup: () => void = () => undefined;
    const input = createInput({
      effectiveInitialContribution: 0,
      interestChoice: true,
      startGoalWalletSetup: () =>
        new Promise<void>((resolve) => {
          finishSetup = resolve;
        }),
    });
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.submitSavingsGoal();
    });
    expect(createSavingsGoal).toHaveBeenCalledTimes(1);

    // Act: another account signs in and back while setup runs.
    signIn('user-b');
    signIn('user-a');
    await act(async () => {
      finishSetup();
      await first;
    });
    await act(async () => {
      await result.current.submitSavingsGoal();
    });

    // Assert: no second plan; the customer is told it already exists.
    expect(createSavingsGoal).toHaveBeenCalledTimes(1);
    expect(input.setFormError).toHaveBeenLastCalledWith(
      PLAN_CREATED_OPEN_WALLET_MESSAGE
    );
  });

  it("keeps each account's created plan when another account submits in between", async () => {
    // Arrange: account A's plan is created, then A switches away mid-setup.
    let finishSetup: () => void = () => undefined;
    const startSetup = jest
      .fn<() => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishSetup = resolve;
          })
      )
      .mockResolvedValue(undefined);
    const input = createInput({
      effectiveInitialContribution: 0,
      interestChoice: true,
      startGoalWalletSetup: startSetup,
    });
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.submitSavingsGoal();
    });
    signIn('user-b');
    await act(async () => {
      finishSetup();
      await first;
    });

    // Act: account B creates its own plan (which finishes on screen), then
    // A comes back and submits the unchanged draft.
    await act(async () => {
      await result.current.submitSavingsGoal();
    });
    expect(createSavingsGoal).toHaveBeenCalledTimes(2);
    signIn('user-a');
    await act(async () => {
      await result.current.submitSavingsGoal();
    });

    // Assert: A's plan is not created a second time.
    expect(createSavingsGoal).toHaveBeenCalledTimes(2);
    expect(input.setFormError).toHaveBeenLastCalledWith(
      PLAN_CREATED_OPEN_WALLET_MESSAGE
    );
  });

  it('lets a plan that finished on screen be followed by a new submit', async () => {
    const input = createInput({ effectiveInitialContribution: 0 });
    const { result } = renderHook(() => useStartSavingsSubmit(input));
    await act(async () => {
      await result.current.submitSavingsGoal();
    });
    await act(async () => {
      await result.current.submitSavingsGoal();
    });
    // The second submit reuses the same goal key, so the server returns the
    // same plan; it is not refused on the device.
    expect(createSavingsGoal).toHaveBeenCalledTimes(2);
    expect(input.setFormError).not.toHaveBeenCalledWith(
      PLAN_CREATED_OPEN_WALLET_MESSAGE
    );
  });

  it('refuses an edited draft too, after switching account away and back', async () => {
    // Arrange: the plan is created, then the account switches away mid-setup.
    let finishSetup: () => void = () => undefined;
    const input = createInput({
      effectiveInitialContribution: 0,
      interestChoice: true,
      startGoalWalletSetup: () =>
        new Promise<void>((resolve) => {
          finishSetup = resolve;
        }),
    });
    const view = renderHook(
      (props: ReturnType<typeof createInput>) => useStartSavingsSubmit(props),
      { initialProps: input }
    );
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = view.result.current.submitSavingsGoal();
    });
    signIn('user-b');
    signIn('user-a');
    await act(async () => {
      finishSetup();
      await first;
    });

    // Act: the customer edits the amount and submits again.
    view.rerender({ ...input, contributionValue: input.contributionValue + 1 });
    await act(async () => {
      await view.result.current.submitSavingsGoal();
    });

    // Assert: still one plan.
    expect(createSavingsGoal).toHaveBeenCalledTimes(1);
    expect(input.setFormError).toHaveBeenLastCalledWith(
      PLAN_CREATED_OPEN_WALLET_MESSAGE
    );
  });
});
