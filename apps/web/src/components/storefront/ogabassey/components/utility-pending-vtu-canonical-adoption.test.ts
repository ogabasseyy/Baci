import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scopePendingVtuSignature } from './utility-pending-vtu-scope';
import { adoptCanonicalVtuKey } from './utility-pending-vtu-canonical-adoption';
import {
  clearPendingVtuKeys,
  forgetPendingVtuPurchase,
  notePendingVtuReference,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from './utility-pending-idempotency';
import { loadPendingVtuSnapshot } from './utility-pending-idempotency-store';
import * as vtuStore from './utility-pending-idempotency-store';
import { parsePendingVtuSnapshot } from './utility-pending-vtu-codec';
import {
  flushPendingVtuPurchases,
  pendingVtuPurchases,
} from './utility-pending-vtu-sync';

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

describe('utility-pending-vtu-canonical-adoption', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
    mockNavigatorLocks();
  });

  // Production descriptors are pre-digested (callers scope once via
  // scopePendingVtuSignature): raw colon-bearing fixtures would
  // migrate-on-read under a scheduled flush and duplicate entries,
  // so every test below scopes its descriptor the production way.
  const scopedDescriptor = (payload: string): string =>
    scopePendingVtuSignature('owner-1', 'merchant-1', payload);

  it('adopts the canonical key after a claim join, preserving entry fields', async () => {
    const scoped = scopedDescriptor('{"a":1}');
    rememberPendingVtuPurchase(scoped, 'key-minted', 'scope-1');
    notePendingVtuReference(scoped, 'REF-1');

    await expect(
      adoptCanonicalVtuKey(scoped, 'key-minted', 'key-winner')
    ).resolves.toBe(true);

    expect(recallPendingVtuKey(scoped)).toBe('key-winner');
    expect(pendingVtuPurchases.get(scoped)).toMatchObject({
      key: 'key-winner',
      reference: 'REF-1',
      scopeTag: 'scope-1',
    });
    // Durable before resolving (Codex R1 P1): a restart recovers
    // the winner key, not the loser. (Entries key by scope digest;
    // the payload carries the adopted key.)
    const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot());
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.[1]).toMatchObject({ key: 'key-winner' });
  });

  it('adoption is a no-op for a missing entry (never resurrect)', async () => {
    const scoped = scopedDescriptor('{"gone":1}');
    await expect(
      adoptCanonicalVtuKey(scoped, 'key-minted', 'key-winner')
    ).resolves.toBe(true);

    expect(recallPendingVtuKey(scoped)).toBeUndefined();
    expect(pendingVtuPurchases.has(scoped)).toBe(false);
  });

  it('adoption is a no-op when the entry is already canonical', async () => {
    const scoped = scopedDescriptor('{"a":2}');
    rememberPendingVtuPurchase(scoped, 'key-winner');
    const before = pendingVtuPurchases.get(scoped);

    await expect(
      adoptCanonicalVtuKey(scoped, 'key-winner', 'key-winner')
    ).resolves.toBe(true);

    expect(pendingVtuPurchases.get(scoped)).toBe(before);
    expect(recallPendingVtuKey(scoped)).toBe('key-winner');
  });

  it('adoption keeps the memory rebind and schedules a retry when the flush fails', async () => {
    // Codex R1 P1 (mobile mirror): storage outage during adoption
    // — memory still rebinds (live retries converge on the
    // winner), false reports the crash window (server-side loser
    // mapping backstops it), and the scheduled retry lands the
    // winner once storage works.
    clearPendingVtuKeys();
    const scoped = scopedDescriptor('{"f":1}');
    rememberPendingVtuPurchase(scoped, 'key-minted');
    const saveSpy = vi
      .spyOn(vtuStore, 'savePendingVtuSnapshot')
      .mockReturnValue(false);
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      await expect(
        adoptCanonicalVtuKey(scoped, 'key-minted', 'key-winner')
      ).resolves.toBe(false);
      expect(recallPendingVtuKey(scoped)).toBe('key-winner');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/not durable/)
      );
    } finally {
      saveSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
    // Storage works again: the scheduled retry persists the winner.
    await flushPendingVtuPurchases();
    const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot());
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.[1]).toMatchObject({ key: 'key-winner' });
  });

  it('adoption no-ops when the live entry already moved generation', async () => {
    // Codex R2 P1 (local half, mobile mirror): the descriptor was
    // rebound since this join response was issued — adopting the
    // old winner would resurrect a superseded generation.
    clearPendingVtuKeys();
    const scoped = scopedDescriptor('{"r":1}');
    rememberPendingVtuPurchase(scoped, 'key-new');
    await flushPendingVtuPurchases();

    await expect(
      adoptCanonicalVtuKey(scoped, 'key-minted', 'key-winner')
    ).resolves.toBe(true);

    expect(recallPendingVtuKey(scoped)).toBe('key-new');
    const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot());
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.[1]).toMatchObject({ key: 'key-new' });
  });

  it('adoption no-ops without flushing when storage holds a newer generation', async () => {
    // Codex R2 P1 (cross-tab half, mobile mirror): a sibling tab
    // persisted a newer same-descriptor key after this tab
    // submitted — this join response is stale. Flushing would
    // overwrite the newer key (memory-wins), orphaning its retry.
    // Production descriptors are pre-digested (callers scope once
    // via scopePendingVtuSignature), so the crafted snapshot uses
    // the same digest key the gate looks up.
    const scoped = scopePendingVtuSignature('owner-1', 'merchant-1', '{"s":1}');
    clearPendingVtuKeys();
    rememberPendingVtuPurchase(scoped, 'key-minted');
    // Drain the remember's scheduled flush BEFORE crafting the
    // sibling write, so nothing rewrites storage afterwards.
    await flushPendingVtuPurchases();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      vtuStore.savePendingVtuSnapshot(
        JSON.stringify({
          entries: [
            [
              scoped,
              {
                key: 'key-fresh',
                reference: null,
                rememberedAt: Date.now(),
                completedAt: null,
                scopeTag: 'scope-1',
              },
            ],
          ],
          forgotten: [],
        })
      )
    ).toBe(true);

    await expect(
      adoptCanonicalVtuKey(scoped, 'key-minted', 'key-winner')
    ).resolves.toBe(true);

    // No rebind, no flush: live memory and the newer persisted
    // generation both survive untouched.
    expect(recallPendingVtuKey(scoped)).toBe('key-minted');
    const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot());
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.[1]).toMatchObject({ key: 'key-fresh' });
  });

  it('does not resurrect an entry forgotten while waiting for the lock', async () => {
    // CodeRabbit #3730: the rebind must re-read the live entry
    // under the lock — a synchronous forget during the lock wait
    // deletes the live entry, and rebinding the pre-lock copy
    // would resurrect it (the tombstone holds the loser key and
    // does not suppress the winner).
    const scoped = scopedDescriptor('{"forgotten":1}');
    rememberPendingVtuPurchase(scoped, 'key-minted');
    const real = vtuStore.runPendingVtuMintLocked;
    let forgot = false;
    const lockSpy = vi
      .spyOn(vtuStore, 'runPendingVtuMintLocked')
      .mockImplementation((async (callback: () => unknown) => {
        if (!forgot) {
          // Exactly once: later lock runs are scheduled flushes
          // sharing the runner. A repeat forget with empty memory
          // would note a keyless tombstone, whose timestamp
          // arbitration reaps even the winner — masking the bug
          // this test pins (a loser-bound tombstone does not
          // suppress the winner entry).
          forgot = true;
          forgetPendingVtuPurchase(scoped);
        }
        return real(callback);
      }) as typeof real);
    try {
      await expect(
        adoptCanonicalVtuKey(scoped, 'key-minted', 'key-winner')
      ).resolves.toBe(true);
    } finally {
      lockSpy.mockRestore();
    }

    expect(recallPendingVtuKey(scoped)).toBeUndefined();
    expect(pendingVtuPurchases.has(scoped)).toBe(false);
    const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot());
    expect(snapshot.entries).toEqual([]);
  });

  it('retries the remaining attempts after a transient lock error', async () => {
    // Jules #3730 Medium (web mirror): the catch inside the
    // 3-attempt loop must not break on the first throw.
    const scoped = scopedDescriptor('{"throwonce":1}');
    rememberPendingVtuPurchase(scoped, 'key-minted');
    // Drain the remember's scheduled flush BEFORE installing the
    // throw-once spy, so the adoption's lock run is the call
    // that throws (not a background flush sharing the runner).
    await flushPendingVtuPurchases();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const real = vtuStore.runPendingVtuMintLocked;
    let calls = 0;
    const lockSpy = vi
      .spyOn(vtuStore, 'runPendingVtuMintLocked')
      .mockImplementation((async (callback: () => unknown) => {
        calls += 1;
        if (calls === 1) {
          throw new Error('transient lock timeout');
        }
        return real(callback);
      }) as typeof real);
    try {
      await expect(
        adoptCanonicalVtuKey(scoped, 'key-minted', 'key-winner')
      ).resolves.toBe(true);
    } finally {
      lockSpy.mockRestore();
    }

    expect(calls).toBeGreaterThan(1);
    expect(recallPendingVtuKey(scoped)).toBe('key-winner');
    const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot());
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.[1]).toMatchObject({ key: 'key-winner' });
  });
});
