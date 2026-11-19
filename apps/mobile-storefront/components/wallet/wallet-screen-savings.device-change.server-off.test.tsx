import { act, renderHook } from '@testing-library/react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { swapSavingsGoalDevice } from '@/lib/customer-savings';
import { useAuthStore } from '@/stores/auth-store';
import type { Product } from '@/types/product';
import { useSavingsNotice } from './savings/savings-notice';
import { changeSavingsGoalDevice } from './wallet-screen-savings.handlers';

jest.mock('@/lib/customer-savings', () => ({
  swapSavingsGoalDevice: jest.fn(),
}));

const goal: WalletActiveSavingsGoal = {
  contribution_amount: 1000,
  contribution_frequency: 'weekly',
  current_amount: 500,
  id: 'goal-1',
  maturity_date: '2026-09-30',
  source_mode: 'manual',
  status: 'active',
  target_amount: 5000,
  title: 'iPhone 13',
};
const product = {
  id: 'p-2',
  name: 'iPhone 14',
  slug: 'iphone-14',
  price: 9000,
  image: 'https://example.test/iphone-14.png',
} satisfies Product;

const change = () =>
  changeSavingsGoalDevice({
    activeMerchantId: 'm-1',
    goal,
    product,
    refetchWallet: async () => ({}),
  });

beforeEach(() => {
  act(() => {
    useAuthStore.setState({
      user: { id: 'user-a' } as never,
      merchantId: 'm-1',
    });
  });
});

// The device swap still works with PiggyVest off; a retry that succeeds
// leaves no earlier failure on the savings sheet.
describe('changing the savings device with the server off', () => {
  it('clears the earlier failure when a retry succeeds', async () => {
    const swap = jest.mocked(swapSavingsGoalDevice);
    const { result } = renderHook(() => useSavingsNotice());

    swap.mockRejectedValueOnce(new Error('Network down'));
    await act(async () => {
      expect(await change()).toBe(false);
    });
    expect(result.current.notice?.title).toBe('Unable to change device');

    swap.mockResolvedValueOnce(undefined as never);
    await act(async () => {
      expect(await change()).toBe(true);
    });
    expect(result.current.notice?.title).toBe('Phone changed');
    expect(result.current.notice?.message).toBe(
      'Your savings now go towards iPhone 14.'
    );
  });

  it('treats a refetch that resolves with isError as a failed refresh', async () => {
    jest
      .mocked(swapSavingsGoalDevice)
      .mockResolvedValueOnce(undefined as never);
    const { result } = renderHook(() => useSavingsNotice());
    await act(async () => {
      expect(
        await changeSavingsGoalDevice({
          activeMerchantId: 'm-1',
          goal,
          product,
          refetchWallet: async () => ({ isError: true }),
        })
      ).toBe(true);
    });
    expect(result.current.notice?.title).toBe('Device updated');
  });

  it('keeps the pull-to-refresh notice when the wallet refresh fails', async () => {
    jest
      .mocked(swapSavingsGoalDevice)
      .mockResolvedValueOnce(undefined as never);
    const { result } = renderHook(() => useSavingsNotice());
    await act(async () => {
      expect(
        await changeSavingsGoalDevice({
          activeMerchantId: 'm-1',
          goal,
          product,
          refetchWallet: async () => {
            throw new Error('offline');
          },
        })
      ).toBe(true);
    });
    expect(result.current.notice?.title).toBe('Device updated');
  });

  it('drops the outcome when the account changes before the swap settles', async () => {
    const swap = jest.mocked(swapSavingsGoalDevice);
    let fail: (error: Error) => void = () => undefined;
    swap.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    const { result } = renderHook(() => useSavingsNotice());
    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => {
      pending = change();
    });
    act(() => {
      useAuthStore.setState({ user: { id: 'user-b' } as never });
    });
    await act(async () => {
      fail(new Error('Network down'));
      await pending;
    });
    expect(result.current.notice).toBeNull();
    // Nor is it waiting for the first account to come back.
    act(() => {
      useAuthStore.setState({ user: { id: 'user-a' } as never });
    });
    expect(result.current.notice).toBeNull();
  });
});
