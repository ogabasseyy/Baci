import { renderHook } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { setSavingsActivityOwner } from '../services/savings-activity-lifecycle';
import { useSavingsLiveActivity } from './use-savings-live-activity';
import type { WalletActiveSavingsGoal } from './wallet-query';

const sync = jest.fn();
const clear = jest.fn();
const goal: WalletActiveSavingsGoal = {
  id: '9f01153c-1589-4dde-b9aa-8f644a846832',
  title: 'Phone',
  current_amount: 107.33,
  target_amount: 250000,
  contribution_amount: 100,
  contribution_frequency: 'monthly',
  source_mode: 'manual',
  status: 'active',
  maturity_date: '2026-12-01',
};

beforeEach(() => {
  jest.clearAllMocks();
  NativeModules.SavingsLiveActivity = { sync, clear };
  setSavingsActivityOwner('user');
  jest.clearAllMocks();
});

it('updates the exact goal when its credited balance changes', () => {
  const { rerender } = renderHook(
    ({ amount }: { amount: number }) =>
      useSavingsLiveActivity({ ...goal, current_amount: amount }, 'user'),
    { initialProps: { amount: 100 } }
  );
  rerender({ amount: 107.33 });
  expect(sync).toHaveBeenLastCalledWith(goal.id, 'Phone', 107.33, 250000);
});

it('clears financial information on sign-out and ignores invalid balances', () => {
  setSavingsActivityOwner(null);
  renderHook(() => useSavingsLiveActivity(goal, null));
  expect(clear).toHaveBeenCalled();
  renderHook(() =>
    useSavingsLiveActivity({ ...goal, current_amount: Number.NaN }, 'user')
  );
  expect(sync).not.toHaveBeenCalled();
});

it('does not fail on builds without the native extension', () => {
  delete NativeModules.SavingsLiveActivity;
  expect(() =>
    renderHook(() => useSavingsLiveActivity(goal, 'user'))
  ).not.toThrow();
});

it('denies activity before auth initializes an owner', () => {
  setSavingsActivityOwner(null);
  jest.clearAllMocks();
  renderHook(() => useSavingsLiveActivity(goal, 'user'));
  expect(sync).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();
});

it('does not send invalid target amounts to the lock-screen activity', () => {
  renderHook(() =>
    useSavingsLiveActivity({ ...goal, target_amount: Number.NaN }, 'user')
  );
  renderHook(() =>
    useSavingsLiveActivity({ ...goal, target_amount: 0 }, 'user')
  );
  expect(sync).not.toHaveBeenCalled();
});

it('clears inherited activity when an authenticated identity initializes before wallet data loads', () => {
  setSavingsActivityOwner('new-user');
  renderHook(() => useSavingsLiveActivity(null, 'new-user'));
  expect(clear).toHaveBeenCalledTimes(1);
  expect(sync).not.toHaveBeenCalled();
});

it('retains same-user activity while loading and clears once when the goal is known to be gone', () => {
  const { rerender } = renderHook(
    ({
      currentGoal,
    }: {
      currentGoal: WalletActiveSavingsGoal | null | undefined;
    }) => useSavingsLiveActivity(currentGoal, 'user'),
    {
      initialProps: {
        currentGoal: goal as WalletActiveSavingsGoal | null | undefined,
      },
    }
  );

  rerender({ currentGoal: undefined });
  expect(clear).not.toHaveBeenCalled();
  expect(sync).toHaveBeenLastCalledWith(goal.id, 'Phone', 107.33, 250000);

  rerender({ currentGoal: null });
  expect(clear).toHaveBeenCalledTimes(1);
  rerender({ currentGoal: null });
  expect(clear).toHaveBeenCalledTimes(1);
});

it('clears once when a synced goal amount becomes invalid', () => {
  const { rerender } = renderHook(
    ({ amount }: { amount: number }) =>
      useSavingsLiveActivity({ ...goal, current_amount: amount }, 'user'),
    { initialProps: { amount: goal.current_amount } }
  );

  rerender({ amount: Number.NaN });
  expect(clear).toHaveBeenCalledTimes(1);
  rerender({ amount: Number.POSITIVE_INFINITY });
  expect(clear).toHaveBeenCalledTimes(1);
});

it('clears and resets tracking on user change before unknown goal data returns', () => {
  const { rerender } = renderHook(
    ({
      currentGoal,
      userId,
    }: {
      currentGoal: WalletActiveSavingsGoal | null | undefined;
      userId: string | null;
    }) => useSavingsLiveActivity(currentGoal, userId),
    {
      initialProps: {
        currentGoal: goal as WalletActiveSavingsGoal | null | undefined,
        userId: 'user',
      },
    }
  );

  setSavingsActivityOwner('next-user');
  jest.clearAllMocks();
  rerender({ currentGoal: undefined, userId: 'next-user' });
  expect(clear).not.toHaveBeenCalled();
  rerender({ currentGoal: null, userId: 'next-user' });
  expect(clear).not.toHaveBeenCalled();
});

it('does not let a stale prior-owner effect clear activity tracked by the new owner', () => {
  const { rerender } = renderHook(
    ({
      currentGoal,
      userId,
    }: {
      currentGoal: WalletActiveSavingsGoal | null | undefined;
      userId: string;
    }) => useSavingsLiveActivity(currentGoal, userId),
    { initialProps: { currentGoal: goal, userId: 'user' } }
  );

  setSavingsActivityOwner('new-user');
  jest.clearAllMocks();
  rerender({ currentGoal: undefined, userId: 'user' });
  expect(clear).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();

  rerender({ currentGoal: goal, userId: 'new-user' });
  expect(sync).toHaveBeenCalledTimes(1);
  expect(sync).toHaveBeenCalledWith(goal.id, 'Phone', 107.33, 250000);
  expect(clear).not.toHaveBeenCalled();
});
