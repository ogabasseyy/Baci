import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CartSubscriptionDeps } from './cart-realtime-client';
import {
  type CartSubscriptionOptions,
  useCartSubscription,
} from './use-cart-subscription';

const access = {
  topic: 'cart:m:c',
  token: 'receive',
  expiresAt: new Date(Date.now() + 300000).toISOString(),
};
function setup() {
  let event: (v: unknown) => void = () => {};
  let status: (joined: boolean) => void = () => {};
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const deps: CartSubscriptionDeps = {
    loadAccess: vi.fn().mockResolvedValue(access),
    connect: vi.fn(async (_access, onEvent, onStatus) => {
      event = onEvent;
      status = onStatus;
      return { disconnect };
    }),
  };
  return {
    deps,
    disconnect,
    event: (v: unknown) => event(v),
    status: (v: boolean) => status(v),
  };
}
const options: CartSubscriptionOptions = {
  enabled: true,
  merchantId: 'm',
  merchantSlug: 'shop',
  cartId: 'c',
  version: 2,
  generation: 1,
  onRefresh: async () => {},
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('private cart subscription', () => {
  it('opens no connection for disabled or absent carts', () => {
    const s = setup();
    const { rerender } = renderHook((p) => useCartSubscription(p, s.deps), {
      initialProps: { ...options, enabled: false },
    });
    rerender({ ...options, enabled: true, cartId: null });
    expect(s.deps.loadAccess).not.toHaveBeenCalled();
  });
  it('refetches on join and only newer same-cart hints, coalescing duplicates', async () => {
    const s = setup();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCartSubscription({ ...options, onRefresh: refresh }, s.deps)
    );
    await waitFor(() => expect(s.deps.connect).toHaveBeenCalledTimes(1));
    await act(async () => s.status(true));
    expect(result.current).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      for (const event of [
        { merchantId: 'other', cartId: 'c', version: 3, operationId: 'x' },
        { merchantId: 'm', cartId: 'c', version: 2, operationId: 'old' },
      ])
        s.event(event);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      s.event({ merchantId: 'm', cartId: 'c', version: 3, operationId: 'new' });
      s.event({
        merchantId: 'm',
        cartId: 'c',
        version: 3,
        operationId: 'duplicate',
      });
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('rejects a foreign or expired credential response', async () => {
    const s = setup();
    vi.mocked(s.deps.loadAccess).mockResolvedValue({
      ...access,
      topic: 'cart:foreign:c',
    });
    renderHook(() => useCartSubscription(options, s.deps));
    await waitFor(() => expect(s.deps.loadAccess).toHaveBeenCalled());
    expect(s.deps.connect).not.toHaveBeenCalled();
  });
  it('disconnects on identity change and fences late old events', async () => {
    const s = setup();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      (p) => useCartSubscription({ ...p, onRefresh: refresh }, s.deps),
      { initialProps: options }
    );
    await waitFor(() => expect(s.deps.connect).toHaveBeenCalledTimes(1));
    rerender({ ...options, enabled: false, generation: 2 });
    await waitFor(() => expect(s.disconnect).toHaveBeenCalledTimes(1));
    await act(async () => {
      s.status(true);
      s.event({
        merchantId: 'm',
        cartId: 'c',
        version: 9,
        operationId: 'late',
      });
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

it('disconnects after 60 hidden seconds and rejoins before foreground recovery', async () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible');
  const s = setup();
  const refresh = vi.fn().mockResolvedValue(undefined);
  renderHook(() =>
    useCartSubscription({ ...options, onRefresh: refresh }, s.deps)
  );
  await act(async () => {});
  expect(s.deps.connect).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => vi.advanceTimersByTime(59999));
  expect(s.disconnect).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(s.disconnect).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue('visible');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(s.deps.connect).toHaveBeenCalledTimes(2);
  await act(async () => s.status(true));
  expect(refresh).toHaveBeenCalledTimes(1);
});
it('fences authority replies arriving after the session was disabled', async () => {
  const s = setup();
  let resolve: (value: typeof access) => void = () => {};
  vi.mocked(s.deps.loadAccess).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const { rerender } = renderHook((p) => useCartSubscription(p, s.deps), {
    initialProps: options,
  });
  await waitFor(() => expect(s.deps.loadAccess).toHaveBeenCalledTimes(1));
  rerender({ ...options, enabled: false });
  await act(async () => resolve(access));
  expect(s.deps.connect).not.toHaveBeenCalled();
});

it('keeps one channel across version changes but reconnects on session generation changes', async () => {
  const s = setup();
  const { rerender } = renderHook((p) => useCartSubscription(p, s.deps), {
    initialProps: options,
  });
  await waitFor(() => expect(s.deps.connect).toHaveBeenCalledTimes(1));
  await act(async () => rerender({ ...options, version: 3 }));
  expect(s.deps.connect).toHaveBeenCalledTimes(1);
  await act(async () => rerender({ ...options, version: 3, generation: 2 }));
  await waitFor(() => expect(s.deps.connect).toHaveBeenCalledTimes(2));
  expect(s.disconnect).toHaveBeenCalledTimes(1);
});

it('keeps a healthy receive channel during a brief background transition', async () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible');
  const s = setup();
  renderHook(() => useCartSubscription(options, s.deps));
  await act(async () => {});
  expect(s.deps.connect).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => vi.advanceTimersByTime(2000));
  visibility.mockReturnValue('visible');
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(s.disconnect).not.toHaveBeenCalled();
  expect(s.deps.loadAccess).toHaveBeenCalledTimes(1);
});

it('retries an unadopted hint after a refresh silently fails, and stops once adopted', async () => {
  vi.useFakeTimers();
  const s = setup();
  const refresh = vi.fn().mockResolvedValue(undefined);
  const { rerender } = renderHook(
    (p) => useCartSubscription({ ...p, onRefresh: refresh }, s.deps),
    { initialProps: options }
  );
  await act(async () => {});
  await act(async () =>
    s.event({ merchantId: 'm', cartId: 'c', version: 3, operationId: 'new' })
  );
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(1000));
  expect(refresh).toHaveBeenCalledTimes(2);
  rerender({ ...options, version: 3 });
  await act(async () => vi.advanceTimersByTime(5000));
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('backs off pending hints to fifteen seconds and pauses retries while hidden', async () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible');
  const s = setup();
  const refresh = vi.fn().mockResolvedValue(undefined);
  renderHook(() =>
    useCartSubscription({ ...options, onRefresh: refresh }, s.deps)
  );
  await act(async () => {});
  await act(async () =>
    s.event({ merchantId: 'm', cartId: 'c', version: 3, operationId: 'new' })
  );
  for (const delay of [1000, 2000, 4000, 8000, 15000, 15000]) {
    const before = refresh.mock.calls.length;
    await act(async () => vi.advanceTimersByTime(delay - 1));
    expect(refresh).toHaveBeenCalledTimes(before);
    await act(async () => vi.advanceTimersByTime(1));
    expect(refresh).toHaveBeenCalledTimes(before + 1);
  }
  visibility.mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  const before = refresh.mock.calls.length;
  await act(async () => vi.advanceTimersByTime(60000));
  expect(refresh).toHaveBeenCalledTimes(before);
  expect(s.disconnect).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue('visible');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => s.status(true));
  expect(refresh).toHaveBeenCalledTimes(before + 1);
});
