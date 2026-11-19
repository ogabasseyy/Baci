import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as crossTab from '@/contexts/customer-identity-invalidation';
import { publishCustomerIdentity } from '@/contexts/customer-live-identity';
import { resetChatCancellationStateForTests } from './chat-cancellation-state';
import { useChatAccountScope } from './use-chat-account-scope';

const mocks = vi.hoisted(() => ({ listeners: new Set<() => void>() }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (listener: () => void) => {
        mocks.listeners.add(listener);
        return {
          data: {
            subscription: {
              unsubscribe: () => mocks.listeners.delete(listener),
            },
          },
        };
      },
    },
  }),
}));

describe('chat account scope', () => {
  beforeEach(resetChatCancellationStateForTests);

  it('invalidates captured work for both identity and auth changes and unsubscribes', () => {
    const { result, unmount } = renderHook(() =>
      useChatAccountScope('ogabassey')
    );
    expect(result.current.status).toBe('ready');
    const first = result.current.capture();
    act(() => publishCustomerIdentity(null, null, 'ogabassey'));
    expect(result.current.isCurrent(first)).toBe(false);
    const second = result.current.capture();
    act(() => {
      for (const listener of mocks.listeners) listener();
    });
    expect(result.current.isCurrent(second)).toBe(false);
    unmount();
    expect(mocks.listeners.size).toBe(0);
  });

  it('refuses to expose account tools if cross-tab invalidation cannot be established', () => {
    const unsubscribe = vi.fn();
    const spy = vi
      .spyOn(crossTab, 'subscribeCustomerIdentityInvalidation')
      .mockReturnValue({ available: false, unsubscribe });
    const { result, unmount } = renderHook(() =>
      useChatAccountScope('ogabassey')
    );
    expect(result.current.status).toBe('unavailable');
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('keeps an uncertain order blocked without blocking another account', () => {
    const { result } = renderHook(() => useChatAccountScope('ogabassey'));
    const firstToken = result.current.capture();
    act(() => expect(result.current.startCancellation('order-a')).toBe(true));
    act(() => publishCustomerIdentity(null, null, 'ogabassey'));
    act(() => result.current.finishCancellation(firstToken, 'uncertain'));
    act(() =>
      result.current.resolveCancellationWarning([
        { id: 'order-b', shipping_status: 'pending' },
      ])
    );
    expect(result.current.cancellationUncertain).toBe(false);
    expect(result.current.isCancellationBlocked('order-a')).toBe(true);
    const secondToken = result.current.capture();
    act(() => expect(result.current.startCancellation('order-b')).toBe(true));
    act(() => result.current.finishCancellation(secondToken, 'confirmed'));
    act(() => publishCustomerIdentity(null, null, 'ogabassey'));
    act(() =>
      result.current.resolveCancellationWarning([
        { id: 'order-a', shipping_status: 'pending' },
      ])
    );
    expect(result.current.cancellationUncertain).toBe(true);
    expect(result.current.isCancellationBlocked('order-a')).toBe(true);
  });

  it('hides a previous account warning on identity change without releasing its order lock', () => {
    const { result } = renderHook(() => useChatAccountScope('ogabassey'));
    const token = result.current.capture();
    act(() => expect(result.current.startCancellation('order-a')).toBe(true));
    act(() => result.current.finishCancellation(token, 'uncertain'));
    expect(result.current.cancellationUncertain).toBe(true);
    act(() => publishCustomerIdentity(null, null, 'ogabassey'));
    expect(result.current.cancellationUncertain).toBe(false);
    expect(result.current.isCancellationBlocked('order-a')).toBe(true);
  });
});
