import { act, renderHook } from '@testing-library/react-native';
import { listSavingsGoals } from '@/lib/customer-savings';
import { asyncStorage } from '@/lib/storage';
import { useWalletDiscoveryHint } from './use-wallet-discovery-hint';

jest.mock('@/lib/customer-savings', () => ({ listSavingsGoals: jest.fn() }));
jest.mock('@/lib/storage', () => ({
  asyncStorage: { getItem: jest.fn(), setItem: jest.fn() },
}));

const list = jest.mocked(listSavingsGoals);
const read = jest.mocked(asyncStorage.getItem);
const write = jest.mocked(asyncStorage.setItem);
const props = { enabled: true, userId: 'user-one', merchantId: 'merchant-one' };
const empty = { goals: [], summary: { savingsBalance: 0, activeGoalCount: 0 } };

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  read.mockResolvedValue(null);
  write.mockResolvedValue();
  list.mockResolvedValue(empty);
});
afterEach(() => jest.useRealTimers());

it('waits for Home to settle, then marks seen after the bubble stays visible', async () => {
  const { result } = renderHook(() => useWalletDiscoveryHint(props));
  expect(result.current.visible).toBe(false);
  expect(list).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(result.current.visible).toBe(true);
  expect(write).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(write).toHaveBeenCalledWith(
    'wallet-savings-discovery:v1:merchant-one:user-one',
    'seen'
  );
  act(() => result.current.dismiss());
  expect(result.current.visible).toBe(false);
  expect(write).toHaveBeenCalledTimes(1);
});

it('marks seen when the customer deliberately dismisses before the dwell completes', async () => {
  const { result } = renderHook(() => useWalletDiscoveryHint(props));
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  act(() => result.current.dismiss());
  expect(write).toHaveBeenCalledWith(
    'wallet-savings-discovery:v1:merchant-one:user-one',
    'seen'
  );
  expect(write).toHaveBeenCalledTimes(1);
});

it('does not mark seen when the bubble is removed before the dwell completes', async () => {
  const { rerender } = renderHook(
    (input: typeof props) => useWalletDiscoveryHint(input),
    { initialProps: props }
  );
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  rerender({ ...props, enabled: false });
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(write).not.toHaveBeenCalled();
});

it('stays dismissed after remounting the app', async () => {
  read.mockResolvedValue('seen');
  const { result } = renderHook(() => useWalletDiscoveryHint(props));
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(result.current.visible).toBe(false);
  expect(list).not.toHaveBeenCalled();
});

it('does not query or show for guests or away from home', async () => {
  const { result } = renderHook(() =>
    useWalletDiscoveryHint({ ...props, enabled: false })
  );
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(result.current.visible).toBe(false);
  expect(list).not.toHaveBeenCalled();
});

it('fails closed when the savings lookup fails', async () => {
  list.mockRejectedValue(new Error('Unavailable'));
  const { result } = renderHook(() => useWalletDiscoveryHint(props));
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(result.current.visible).toBe(false);
  expect(write).not.toHaveBeenCalled();
});

it('does not show for a customer with an existing plan', async () => {
  list.mockResolvedValue({
    goals: [
      {
        breakFeePercent: 0,
        contributionAmount: 100,
        contributionFrequency: 'monthly',
        currentAmount: 0,
        id: 'plan',
        maturityDate: '2027-10-14',
        productId: 'phone',
        sourceMode: 'manual',
        startDate: '2026-10-14',
        status: 'active',
        targetAmount: 250000,
        title: 'Phone',
        variantId: null,
      },
    ],
    summary: { savingsBalance: 0, activeGoalCount: 1 },
  });
  const { result } = renderHook(() => useWalletDiscoveryHint(props));
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(result.current.visible).toBe(false);
  expect(write).not.toHaveBeenCalled();
});

it('cancels the delayed hint when navigating away from home', async () => {
  const { result, rerender } = renderHook(
    (input: typeof props) => useWalletDiscoveryHint(input),
    { initialProps: props }
  );
  rerender({ ...props, enabled: false });
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(result.current.visible).toBe(false);
  expect(list).not.toHaveBeenCalled();
});

it('ignores an empty response from the previous user after an account switch', async () => {
  let resolvePrevious: ((value: typeof empty) => void) | undefined;
  list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolvePrevious = resolve;
      })
  );
  const { result, rerender } = renderHook(
    (input: typeof props) => useWalletDiscoveryHint(input),
    { initialProps: props }
  );
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  rerender({ ...props, userId: 'user-two' });
  await act(async () => {
    resolvePrevious?.(empty);
  });
  expect(result.current.visible).toBe(false);
  expect(write).not.toHaveBeenCalled();
});
