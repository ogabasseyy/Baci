import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { publishCustomerIdentity } from '@/contexts/customer-live-identity';
import * as crossTab from '@/contexts/customer-identity-invalidation';
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
});
