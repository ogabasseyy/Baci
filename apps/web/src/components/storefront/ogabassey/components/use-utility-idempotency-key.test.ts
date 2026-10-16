import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingVtuKeys,
  hasNotedPendingVtuReference,
  markPendingVtuCompleted,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from './utility-pending-idempotency';
import { scopePendingVtuSignature } from './utility-pending-vtu-scope';
import {
  finalizeSuppressedAttempt,
  shouldRotateVtuKeyForStatus,
  useUtilityIdempotencyKey,
} from './use-utility-idempotency-key';

// jsdom ships no navigator.locks, and the mint runner fails closed
// in multi-tab browsers without it (Codex R152 P1) — pin an
// immediate-grant mock so these tests exercise the locks path.
function mockNavigatorLocks(): void {
  Object.defineProperty(navigator, 'locks', {
    value: {
      request: async (_name: string, callback: () => unknown) => callback(),
    },
    configurable: true,
  });
}

describe('useUtilityIdempotencyKey', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
    mockNavigatorLocks();
  });

  it('returns a stable key until the attempt is forgotten', async () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );

    let first = '';
    let second = '';
    let scoped = '';
    await act(async () => {
      const attempt = await result.current.captureAttemptKey('SIG');
      first = attempt.key;
      scoped = attempt.scoped;
      second = (await result.current.captureAttemptKey('SIG')).key;
    });
    expect(first).toBe(second);

    await act(async () => {
      result.current.forgetScopedKey(scoped);
    });
    let third = '';
    await act(async () => {
      third = (await result.current.captureAttemptKey('SIG')).key;
    });
    expect(third).not.toBe(first);
  });

  it('isolates keys by owner so a second customer never recalls the first’s key', async () => {
    const firstOwner = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let keyA = '';
    await act(async () => {
      keyA = (await firstOwner.result.current.captureAttemptKey('SIG')).key;
    });
    firstOwner.unmount();

    const secondOwner = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-b' })
    );
    let keyB = '';
    await act(async () => {
      keyB = (await secondOwner.result.current.captureAttemptKey('SIG')).key;
    });

    expect(keyB).not.toBe(keyA);
  });

  it('recalls the pending key across hook instances for the same owner', async () => {
    const firstMount = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let key = '';
    await act(async () => {
      const attempt = await firstMount.result.current.captureAttemptKey('SIG');
      key = attempt.key;
      expect(attempt.recalled).toBe(false);
    });
    firstMount.unmount();

    const secondMount = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let recalled = '';
    await act(async () => {
      const attempt = await secondMount.result.current.captureAttemptKey('SIG');
      recalled = attempt.key;
      expect(attempt.recalled).toBe(true);
    });

    expect(recalled).toBe(key);
  });

  it('keeps recalling the pending key when customer hydration lands', async () => {
    // Hydration regression: only the session user ID is known at first;
    // customers.id arrives later and is a DIFFERENT id. Scope must not
    // flip, or the retry orphans the key and double-debits.
    const { result, unmount } = renderHook(
      (props: { customerId?: string; userId?: string }) =>
        useUtilityIdempotencyKey(props),
      { initialProps: { userId: 'user-a' } }
    );
    let key = '';
    await act(async () => {
      key = (await result.current.captureAttemptKey('SIG')).key;
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
    await act(async () => {
      recalled = (await lateHydration.result.current.captureAttemptKey('SIG')).key;
    });

    expect(recalled).toBe(key);
  });

  it('recognizes a noted reference as a replay of its processing vend', async () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );

    let scoped = '';
    await act(async () => {
      scoped = (await result.current.captureAttemptKey('SIG')).scoped;
    });
    expect(result.current.isScopedReplay(scoped, 'REF-1')).toBe(false);

    await act(async () => {
      result.current.noteScopedReference(scoped, 'REF-1');
    });
    expect(result.current.isScopedReplay(scoped, 'REF-1')).toBe(true);
    expect(result.current.isScopedReplay(scoped, 'REF-OTHER')).toBe(false);
  });

  it('binds completion to the submitting owner across a mid-flight switch', async () => {
    // The scope is captured when the key is issued: even if the hook
    // re-renders as customer B before A’s request settles, noting the
    // reference still lands on A’s entry — never B’s.
    const { result, rerender } = renderHook(
      (props: { customerId?: string; userId?: string }) =>
        useUtilityIdempotencyKey(props),
      { initialProps: { customerId: 'customer-a' } }
    );
    let scoped = '';
    await act(async () => {
      scoped = (await result.current.captureAttemptKey('SIG')).scoped;
    });

    rerender({ customerId: 'customer-b' });
    await act(async () => {
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

  it('keeps concurrent attempts independent via per-execution captures', async () => {
    // Two overlapping submits must not share mutable hook state: each
    // capture finalizes exactly its own entry.
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );

    let attemptA = { key: '', scoped: '', recalled: false };
    let attemptB = { key: '', scoped: '', recalled: false };
    await act(async () => {
      attemptA = await result.current.captureAttemptKey('SIG-A');
      attemptB = await result.current.captureAttemptKey('SIG-B');
    });
    await act(async () => {
      result.current.forgetScopedKey(attemptA.scoped);
    });

    let recallA = '';
    let recallB = '';
    await act(async () => {
      recallA = (await result.current.captureAttemptKey('SIG-A')).key;
      recallB = (await result.current.captureAttemptKey('SIG-B')).key;
    });
    expect(recallA).not.toBe(attemptA.key);
    expect(recallB).toBe(attemptB.key);
  });

  it('reports a success stale only when completion is past the window', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useUtilityIdempotencyKey({ customerId: 'customer-a' })
      );
      let scoped = '';
      await act(async () => {
        scoped = (await result.current.captureAttemptKey('SIG')).scoped;
        result.current.noteScopedReference(scoped, 'REF-1');
      });
      expect(result.current.isScopedStale(scoped, 'REF-1')).toBe(false);

      await act(async () => {
        vi.advanceTimersByTime(6 * 60 * 1000);
      });
      // Noted but never completed: still not stale — a slow first
      // completion must present, not "Already Completed".
      expect(result.current.isScopedStale(scoped, 'REF-1')).toBe(false);

      await act(async () => {
        markPendingVtuCompleted(scoped);
      });
      expect(result.current.isScopedStale(scoped, 'REF-1')).toBe(false);
      await act(async () => {
        vi.advanceTimersByTime(6 * 60 * 1000);
      });
      expect(result.current.isScopedStale(scoped, 'REF-1')).toBe(true);
      expect(result.current.isScopedStale(scoped, 'REF-OTHER')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles only the shown generation when a newer key went live', async () => {
    // Codex R137 P1 (hook threading): mark carries the shown key
    // through, so settle tombstones exactly it — a cross-tab
    // buy-again under the same scope survives instead of being
    // reaped (its retry would mint fresh and debit twice).
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );

    let scoped = '';
    let shownKey = '';
    await act(async () => {
      const attempt = await result.current.captureAttemptKey('SIG-SHOWN');
      scoped = attempt.scoped;
      shownKey = attempt.key;
      result.current.markAttemptShown(scoped, shownKey);
    });
    // Cross-tab buy-again lands before the settle runs.
    rememberPendingVtuPurchase(scoped, 'key-newer-generation');

    await act(async () => {
      result.current.settleShownAttempt();
    });

    expect(recallPendingVtuKey(scoped)).toBe('key-newer-generation');
  });
});

describe('finalizeSuppressedAttempt', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
    mockNavigatorLocks();
  });

  it('preserves a switched terminal success so the returnee replays it', async () => {
    // The charge committed to the submitter while their UI was
    // suppressed: forgetting would mint a fresh key on their
    // switch-back repeat and debit/vend a second time. The repeat
    // must reuse the key AND recognize the completed reference.
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let attempt = { key: '', scoped: '', recalled: false };
    await act(async () => {
      attempt = await result.current.captureAttemptKey('SIG');
    });

    finalizeSuppressedAttempt(attempt, {
      kind: 'wallet-success',
      reference: 'REF-1',
      amount: 1000,
      processing: false,
    });

    let repeat = '';
    await act(async () => {
      repeat = (await result.current.captureAttemptKey('SIG')).key;
    });
    expect(repeat).toBe(attempt.key);
    expect(result.current.isScopedReplay(attempt.scoped, 'REF-1')).toBe(true);
  });

  it('records completion on switched terminal success (processing notes do not)', async () => {
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
      await act(async () => {
        terminal = await result.current.captureAttemptKey('SIG-TERM');
        processing = await result.current.captureAttemptKey('SIG-PROC');
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

      await act(async () => {
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

  it('notes the reference when the switched result is processing', async () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let attempt = { key: '', scoped: '', recalled: false };
    await act(async () => {
      attempt = await result.current.captureAttemptKey('SIG');
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

  it('keeps the key for errors and null attempts', async () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let attempt = { key: '', scoped: '', recalled: false };
    await act(async () => {
      attempt = await result.current.captureAttemptKey('SIG');
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
    await act(async () => {
      repeat = (await result.current.captureAttemptKey('SIG')).key;
    });
    expect(repeat).toBe(attempt.key);
  });

  it('forgets a terminal 4xx error so the returnee retries fresh', async () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let attempt = { key: '', scoped: '', recalled: false };
    await act(async () => {
      attempt = await result.current.captureAttemptKey('SIG');
    });

    finalizeSuppressedAttempt(attempt, {
      kind: 'error',
      message: 'Insufficient funds',
      status: 400,
    });

    let repeat = '';
    await act(async () => {
      repeat = (await result.current.captureAttemptKey('SIG')).key;
    });
    expect(repeat).not.toBe(attempt.key);
  });

  it('keeps the key for a pre-route 429 error after a switch', async () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let attempt = { key: '', scoped: '', recalled: false };
    await act(async () => {
      attempt = await result.current.captureAttemptKey('SIG');
    });

    finalizeSuppressedAttempt(attempt, {
      kind: 'error',
      message: 'Too many requests',
      status: 429,
    });

    let repeat = '';
    await act(async () => {
      repeat = (await result.current.captureAttemptKey('SIG')).key;
    });
    expect(repeat).toBe(attempt.key);
  });
});

describe('shouldRotateVtuKeyForStatus', () => {
  it('returns true for definitive route 4xx (outcome recorded, key is dead)', async () => {
    for (const status of [400, 404, 409, 422]) {
      expect(shouldRotateVtuKeyForStatus(status)).toBe(true);
    }
  });

  it('returns false for pre-route 401/403/413/415/429 — handler never ran', async () => {
    // A 429 retry of an already-committed attempt must keep the key:
    // rotating would mint a fresh key and debit a second transaction.
    for (const status of [401, 403, 413, 415, 429]) {
      expect(shouldRotateVtuKeyForStatus(status)).toBe(false);
    }
  });

  it('returns false for 408/425 timeouts — ambiguous infrastructure responses', async () => {
    // Codex R95 P1: either can arrive after the handler accepted the
    // request or committed the debit, so the retry must dedupe on the
    // retained key instead of minting a fresh UUID and debiting twice.
    for (const status of [408, 425]) {
      expect(shouldRotateVtuKeyForStatus(status)).toBe(false);
    }
  });

  it('returns false for 5xx and missing statuses', async () => {
    expect(shouldRotateVtuKeyForStatus(500)).toBe(false);
    expect(shouldRotateVtuKeyForStatus(502)).toBe(false);
    expect(shouldRotateVtuKeyForStatus(undefined)).toBe(false);
  });
});

describe('settleShownAttempt', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
    mockNavigatorLocks();
  });

  it('forgets the marked key once; a second call is a no-op', async () => {
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
      await act(async () => {
        attempt = await result.current.captureAttemptKey('SIG');
      });
      await act(async () => {
        result.current.markAttemptShown(attempt.scoped);
      });
      await act(async () => {
        result.current.settleShownAttempt();
      });

      now += 60_000;
      let repeat = '';
      await act(async () => {
        repeat = (await result.current.captureAttemptKey('SIG')).key;
      });
      expect(repeat).not.toBe(attempt.key);

      await act(async () => {
        result.current.settleShownAttempt();
      });
      let again = '';
      await act(async () => {
        again = (await result.current.captureAttemptKey('SIG')).key;
      });
      expect(again).toBe(repeat);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('is a no-op when nothing was marked', async () => {
    const { result } = renderHook(() =>
      useUtilityIdempotencyKey({ customerId: 'customer-a' })
    );
    let attempt = { key: '', scoped: '', recalled: false };
    await act(async () => {
      attempt = await result.current.captureAttemptKey('SIG');
    });

    await act(async () => {
      result.current.settleShownAttempt();
    });

    let repeat = '';
    await act(async () => {
      repeat = (await result.current.captureAttemptKey('SIG')).key;
    });
    expect(repeat).toBe(attempt.key);
  });
});
