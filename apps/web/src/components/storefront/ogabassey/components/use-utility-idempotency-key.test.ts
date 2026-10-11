import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingVtuKeys,
  hasNotedPendingVtuReference,
  scopePendingVtuSignature,
} from './utility-pending-idempotency';
import { useUtilityIdempotencyKey } from './use-utility-idempotency-key';

describe('useUtilityIdempotencyKey', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
  });

  it('returns a stable key until the attempt is forgotten', () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );

    let first = '';
    let second = '';
    act(() => {
      first = result.current.getWalletIdempotencyKey('SIG');
      second = result.current.getWalletIdempotencyKey('SIG');
    });
    expect(first).toBe(second);

    act(() => {
      result.current.forgetAttemptKey();
    });
    let third = '';
    act(() => {
      third = result.current.getWalletIdempotencyKey('SIG');
    });
    expect(third).not.toBe(first);
  });

  it('isolates keys by owner so a second customer never recalls the first’s key', () => {
    const firstOwner = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let keyA = '';
    act(() => {
      keyA = firstOwner.result.current.getWalletIdempotencyKey('SIG');
    });
    firstOwner.unmount();

    const secondOwner = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-b' })
    );
    let keyB = '';
    act(() => {
      keyB = secondOwner.result.current.getWalletIdempotencyKey('SIG');
    });

    expect(keyB).not.toBe(keyA);
  });

  it('recalls the pending key across hook instances for the same owner', () => {
    const firstMount = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let key = '';
    act(() => {
      key = firstMount.result.current.getWalletIdempotencyKey('SIG');
    });
    firstMount.unmount();

    const secondMount = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let recalled = '';
    act(() => {
      recalled = secondMount.result.current.getWalletIdempotencyKey('SIG');
    });

    expect(recalled).toBe(key);
  });

  it('keeps recalling the pending key when customer hydration lands', () => {
    // Hydration regression: only the session user ID is known at first;
    // customers.id arrives later and is a DIFFERENT id. Scope must not
    // flip, or the retry orphans the key and double-debits.
    const { result, unmount } = renderHook(
      (props: { customerId?: string; userId?: string }) =>
        useUtilityIdempotencyKey(props),
      { initialProps: { userId: 'user-a' } }
    );
    let key = '';
    act(() => {
      key = result.current.getWalletIdempotencyKey('SIG');
    });
    unmount();

    const lateHydration = renderHook(
      (props: { customerId?: string; userId?: string }) =>
        useUtilityIdempotencyKey(props),
      {
        initialProps: { userId: 'user-a', customerId: 'customer-a' },
      }
    );
    let recalled = '';
    act(() => {
      recalled = lateHydration.result.current.getWalletIdempotencyKey('SIG');
    });

    expect(recalled).toBe(key);
  });

  it('recognizes a noted reference as a replay of its processing vend', () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );

    act(() => {
      result.current.getWalletIdempotencyKey('SIG');
    });
    expect(result.current.isAttemptReplay('REF-1')).toBe(false);

    act(() => {
      result.current.noteAttemptReference('REF-1');
    });
    expect(result.current.isAttemptReplay('REF-1')).toBe(true);
    expect(result.current.isAttemptReplay('REF-OTHER')).toBe(false);
  });

  it('binds completion to the submitting owner across a mid-flight switch', () => {
    // The scope is captured when the key is issued: even if the hook
    // re-renders as customer B before A’s request settles, noting the
    // reference still lands on A’s entry — never B’s.
    const { result, rerender } = renderHook(
      (props: { customerId?: string; userId?: string }) =>
        useUtilityIdempotencyKey(props),
      { initialProps: { customerId: 'customer-a' } }
    );
    act(() => {
      result.current.getWalletIdempotencyKey('SIG');
    });

    rerender({ customerId: 'customer-b' });
    act(() => {
      result.current.noteAttemptReference('REF-1');
    });

    expect(
      hasNotedPendingVtuReference(
        scopePendingVtuSignature('customer-a', undefined, 'SIG'),
        'REF-1'
      )
    ).toBe(true);
    expect(
      hasNotedPendingVtuReference(
        scopePendingVtuSignature('customer-b', undefined, 'SIG'),
        'REF-1'
      )
    ).toBe(false);
  });

  it('reports a success stale only when the noted reference is past the window', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useUtilityIdempotencyKey({ customerId: 'customer-a' })
      );
      act(() => {
        result.current.getWalletIdempotencyKey('SIG');
        result.current.noteAttemptReference('REF-1');
      });
      expect(result.current.isAttemptStale('REF-1')).toBe(false);

      act(() => {
        vi.advanceTimersByTime(6 * 60 * 1000);
      });
      expect(result.current.isAttemptStale('REF-1')).toBe(true);
      expect(result.current.isAttemptStale('REF-OTHER')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
