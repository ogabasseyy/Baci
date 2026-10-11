import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingVtuKeys,
  hasNotedPendingVtuReference,
  scopePendingVtuSignature,
} from './utility-pending-idempotency';
import {
  finalizeSwitchedAttempt,
  shouldRotateVtuKeyForStatus,
  useUtilityIdempotencyKey,
} from './use-utility-idempotency-key';

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
    let scoped = '';
    act(() => {
      const attempt = result.current.captureAttemptKey('SIG');
      first = attempt.key;
      scoped = attempt.scoped;
      second = result.current.captureAttemptKey('SIG').key;
    });
    expect(first).toBe(second);

    act(() => {
      result.current.forgetScopedKey(scoped);
    });
    let third = '';
    act(() => {
      third = result.current.captureAttemptKey('SIG').key;
    });
    expect(third).not.toBe(first);
  });

  it('isolates keys by owner so a second customer never recalls the first’s key', () => {
    const firstOwner = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let keyA = '';
    act(() => {
      keyA = firstOwner.result.current.captureAttemptKey('SIG').key;
    });
    firstOwner.unmount();

    const secondOwner = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-b' })
    );
    let keyB = '';
    act(() => {
      keyB = secondOwner.result.current.captureAttemptKey('SIG').key;
    });

    expect(keyB).not.toBe(keyA);
  });

  it('recalls the pending key across hook instances for the same owner', () => {
    const firstMount = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let key = '';
    act(() => {
      const attempt = firstMount.result.current.captureAttemptKey('SIG');
      key = attempt.key;
      expect(attempt.recalled).toBe(false);
    });
    firstMount.unmount();

    const secondMount = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let recalled = '';
    act(() => {
      const attempt = secondMount.result.current.captureAttemptKey('SIG');
      recalled = attempt.key;
      expect(attempt.recalled).toBe(true);
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
      key = result.current.captureAttemptKey('SIG').key;
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
      recalled = lateHydration.result.current.captureAttemptKey('SIG').key;
    });

    expect(recalled).toBe(key);
  });

  it('recognizes a noted reference as a replay of its processing vend', () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );

    let scoped = '';
    act(() => {
      scoped = result.current.captureAttemptKey('SIG').scoped;
    });
    expect(result.current.isScopedReplay(scoped, 'REF-1')).toBe(false);

    act(() => {
      result.current.noteScopedReference(scoped, 'REF-1');
    });
    expect(result.current.isScopedReplay(scoped, 'REF-1')).toBe(true);
    expect(result.current.isScopedReplay(scoped, 'REF-OTHER')).toBe(false);
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
    let scoped = '';
    act(() => {
      scoped = result.current.captureAttemptKey('SIG').scoped;
    });

    rerender({ customerId: 'customer-b' });
    act(() => {
      result.current.noteScopedReference(scoped, 'REF-1');
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

  it('keeps concurrent attempts independent via per-execution captures', () => {
    // Two overlapping submits must not share mutable hook state: each
    // capture finalizes exactly its own entry.
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );

    let attemptA = { key: '', scoped: '', recalled: false };
    let attemptB = { key: '', scoped: '', recalled: false };
    act(() => {
      attemptA = result.current.captureAttemptKey('SIG-A');
      attemptB = result.current.captureAttemptKey('SIG-B');
    });
    act(() => {
      result.current.forgetScopedKey(attemptA.scoped);
    });

    let recallA = '';
    let recallB = '';
    act(() => {
      recallA = result.current.captureAttemptKey('SIG-A').key;
      recallB = result.current.captureAttemptKey('SIG-B').key;
    });
    expect(recallA).not.toBe(attemptA.key);
    expect(recallB).toBe(attemptB.key);
  });

  it('reports a success stale only when the noted reference is past the window', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useUtilityIdempotencyKey({ customerId: 'customer-a' })
      );
      let scoped = '';
      act(() => {
        scoped = result.current.captureAttemptKey('SIG').scoped;
        result.current.noteScopedReference(scoped, 'REF-1');
      });
      expect(result.current.isScopedStale(scoped, 'REF-1')).toBe(false);

      act(() => {
        vi.advanceTimersByTime(6 * 60 * 1000);
      });
      expect(result.current.isScopedStale(scoped, 'REF-1')).toBe(true);
      expect(result.current.isScopedStale(scoped, 'REF-OTHER')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('finalizeSwitchedAttempt', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
  });

  it('forgets a terminal success so the returnee mints fresh', () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let attempt = { key: '', scoped: '', recalled: false };
    act(() => {
      attempt = result.current.captureAttemptKey('SIG');
    });

    finalizeSwitchedAttempt(attempt, {
      kind: 'wallet-success',
      reference: 'REF-1',
      amount: 1000,
      processing: false,
    });

    let repeat = '';
    act(() => {
      repeat = result.current.captureAttemptKey('SIG').key;
    });
    expect(repeat).not.toBe(attempt.key);
  });

  it('notes the reference when the switched result is processing', () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let attempt = { key: '', scoped: '', recalled: false };
    act(() => {
      attempt = result.current.captureAttemptKey('SIG');
    });

    finalizeSwitchedAttempt(attempt, {
      kind: 'wallet-success',
      reference: 'REF-PROC',
      amount: 1000,
      processing: true,
    });

    expect(result.current.isScopedReplay(attempt.scoped, 'REF-PROC')).toBe(
      true
    );
  });

  it('keeps the key for errors and null attempts', () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let attempt = { key: '', scoped: '', recalled: false };
    act(() => {
      attempt = result.current.captureAttemptKey('SIG');
    });

    finalizeSwitchedAttempt(attempt, {
      kind: 'error',
      message: 'timeout',
    });
    finalizeSwitchedAttempt(null, {
      kind: 'wallet-success',
      reference: 'REF-1',
      amount: 1000,
      processing: false,
    });

    let repeat = '';
    act(() => {
      repeat = result.current.captureAttemptKey('SIG').key;
    });
    expect(repeat).toBe(attempt.key);
  });

  it('forgets a terminal 4xx error so the returnee retries fresh', () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let attempt = { key: '', scoped: '', recalled: false };
    act(() => {
      attempt = result.current.captureAttemptKey('SIG');
    });

    finalizeSwitchedAttempt(attempt, {
      kind: 'error',
      message: 'Insufficient funds',
      status: 400,
    });

    let repeat = '';
    act(() => {
      repeat = result.current.captureAttemptKey('SIG').key;
    });
    expect(repeat).not.toBe(attempt.key);
  });

  it('keeps the key for a pre-route 429 error after a switch', () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let attempt = { key: '', scoped: '', recalled: false };
    act(() => {
      attempt = result.current.captureAttemptKey('SIG');
    });

    finalizeSwitchedAttempt(attempt, {
      kind: 'error',
      message: 'Too many requests',
      status: 429,
    });

    let repeat = '';
    act(() => {
      repeat = result.current.captureAttemptKey('SIG').key;
    });
    expect(repeat).toBe(attempt.key);
  });
});

describe('shouldRotateVtuKeyForStatus', () => {
  it('returns true for definitive route 4xx (outcome recorded, key is dead)', () => {
    for (const status of [400, 404, 409, 422]) {
      expect(shouldRotateVtuKeyForStatus(status)).toBe(true);
    }
  });

  it('returns false for pre-route 401/403/413/415/429 — handler never ran', () => {
    // A 429 retry of an already-committed attempt must keep the key:
    // rotating would mint a fresh key and debit a second transaction.
    for (const status of [401, 403, 413, 415, 429]) {
      expect(shouldRotateVtuKeyForStatus(status)).toBe(false);
    }
  });

  it('returns false for 5xx and missing statuses', () => {
    expect(shouldRotateVtuKeyForStatus(500)).toBe(false);
    expect(shouldRotateVtuKeyForStatus(502)).toBe(false);
    expect(shouldRotateVtuKeyForStatus(undefined)).toBe(false);
  });
});
