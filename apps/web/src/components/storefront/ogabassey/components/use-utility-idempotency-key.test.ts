import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingVtuKeys,
  hasNotedPendingVtuReference,
  markPendingVtuCompleted,
} from './utility-pending-idempotency';
import { scopePendingVtuSignature } from './utility-pending-vtu-scope';
import {
  finalizeSuppressedAttempt,
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

  it('reports a success stale only when completion is past the window', () => {
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
      // Noted but never completed: still not stale — a slow first
      // completion must present, not "Already Completed".
      expect(result.current.isScopedStale(scoped, 'REF-1')).toBe(false);

      act(() => {
        markPendingVtuCompleted(scoped);
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

describe('finalizeSuppressedAttempt', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
  });

  it('preserves a switched terminal success so the returnee replays it', () => {
    // The charge committed to the submitter while their UI was
    // suppressed: forgetting would mint a fresh key on their
    // switch-back repeat and debit/vend a second time. The repeat
    // must reuse the key AND recognize the completed reference.
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let attempt = { key: '', scoped: '', recalled: false };
    act(() => {
      attempt = result.current.captureAttemptKey('SIG');
    });

    finalizeSuppressedAttempt(attempt, {
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
    expect(result.current.isScopedReplay(attempt.scoped, 'REF-1')).toBe(true);
  });

  it('records completion on switched terminal success (processing notes do not)', () => {
    // The stale guard keys off completion time: a switch-back repeat
    // minutes later must present this vend, while a repeat long after
    // reports "Already Completed". Processing notes must NOT mark.
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useUtilityIdempotencyKey({ customerId: 'customer-a' })
      );
      let terminal = { key: '', scoped: '', recalled: false };
      let processing = { key: '', scoped: '', recalled: false };
      act(() => {
        terminal = result.current.captureAttemptKey('SIG-TERM');
        processing = result.current.captureAttemptKey('SIG-PROC');
      });

      finalizeSuppressedAttempt(terminal, {
        kind: 'wallet-success',
        reference: 'REF-TERM',
        amount: 1000,
        processing: false,
      });
      finalizeSuppressedAttempt(processing, {
        kind: 'wallet-success',
        reference: 'REF-PROC',
        amount: 1000,
        processing: true,
      });
      expect(
        result.current.isScopedStale(terminal.scoped, 'REF-TERM')
      ).toBe(false);

      act(() => {
        vi.advanceTimersByTime(6 * 60 * 1000);
      });
      expect(result.current.isScopedStale(terminal.scoped, 'REF-TERM')).toBe(
        true
      );
      expect(
        result.current.isScopedStale(processing.scoped, 'REF-PROC')
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('notes the reference when the switched result is processing', () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let attempt = { key: '', scoped: '', recalled: false };
    act(() => {
      attempt = result.current.captureAttemptKey('SIG');
    });

    finalizeSuppressedAttempt(attempt, {
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

    finalizeSuppressedAttempt(attempt, {
      kind: 'error',
      message: 'timeout',
    });
    finalizeSuppressedAttempt(null, {
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

    finalizeSuppressedAttempt(attempt, {
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

    finalizeSuppressedAttempt(attempt, {
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

describe('settleShownAttempt', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
  });

  it('forgets the marked key once; a second call is a no-op', () => {
    // Controlled clock: the tombstone kills same-ms re-remembers, so
    // the post-settle capture must land in a later millisecond (as any
    // real buy-again would).
    let now = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const { result } = renderHook(() =>
        useUtilityIdempotencyKey({ customerId: 'customer-a' })
      );
      let attempt = { key: '', scoped: '', recalled: false };
      act(() => {
        attempt = result.current.captureAttemptKey('SIG');
      });
      act(() => {
        result.current.markAttemptShown(attempt.scoped);
      });
      act(() => {
        result.current.settleShownAttempt();
      });

      now += 60_000;
      let repeat = '';
      act(() => {
        repeat = result.current.captureAttemptKey('SIG').key;
      });
      expect(repeat).not.toBe(attempt.key);

      act(() => {
        result.current.settleShownAttempt();
      });
      let again = '';
      act(() => {
        again = result.current.captureAttemptKey('SIG').key;
      });
      expect(again).toBe(repeat);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('is a no-op when nothing was marked', () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let attempt = { key: '', scoped: '', recalled: false };
    act(() => {
      attempt = result.current.captureAttemptKey('SIG');
    });

    act(() => {
      result.current.settleShownAttempt();
    });

    let repeat = '';
    act(() => {
      repeat = result.current.captureAttemptKey('SIG').key;
    });
    expect(repeat).toBe(attempt.key);
  });
});
