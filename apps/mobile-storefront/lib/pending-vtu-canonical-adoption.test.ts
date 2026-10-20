let mockNextUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `uuid-${++mockNextUuid}`,
}));

import { adoptCanonicalVtuKey } from './pending-vtu-canonical-adoption';
import {
  clearPendingVtuKeys,
  forgetPendingVtuPurchase,
  notePendingVtuReference,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from './pending-vtu-idempotency';
import { parsePendingVtuSnapshot } from './pending-vtu-idempotency-codec';
import * as vtuStore from './pending-vtu-idempotency-store';
import * as vtuSync from './pending-vtu-idempotency-sync';
import {
  flushPendingVtuPurchases,
  pendingPurchases,
} from './pending-vtu-idempotency-sync';

describe('pending-vtu-canonical-adoption', () => {
  // Suite-level isolation (Muse R123 low): the MMKV mock buckets
  // persist across tests in a file, so a test that forgets its
  // manual clear would leak a retained key into the next test.
  // The escape hatch clears both the in-memory registry and the
  // persisted snapshot; per-test manual clears stay as documentation.
  beforeEach(() => {
    clearPendingVtuKeys();
    vtuStore.clearPendingVtuMintLock();
  });

  it('adopts the canonical key after a claim join, preserving entry fields', async () => {
    rememberPendingVtuPurchase('desc-adopt', 'key-minted', 'scope-1');
    notePendingVtuReference('desc-adopt', 'REF-1');

    await expect(
      adoptCanonicalVtuKey('desc-adopt', 'key-minted', 'key-winner')
    ).resolves.toBe(true);

    expect(recallPendingVtuKey('desc-adopt')).toBe('key-winner');
    expect(pendingPurchases.get('desc-adopt')).toMatchObject({
      key: 'key-winner',
      reference: 'REF-1',
      scopeTag: 'scope-1',
    });
    // Durable before resolving (Codex R1 P1): a restart recovers
    // the winner key, not the loser.
    const snapshot = parsePendingVtuSnapshot(vtuStore.loadPendingVtuSnapshot());
    expect(snapshot.entries).toEqual([
      ['desc-adopt', expect.objectContaining({ key: 'key-winner' })],
    ]);
  });

  it('adoption is a no-op for a missing entry (never resurrect)', async () => {
    await expect(
      adoptCanonicalVtuKey('desc-gone', 'key-minted', 'key-winner')
    ).resolves.toBe(true);

    expect(recallPendingVtuKey('desc-gone')).toBeNull();
    expect(pendingPurchases.has('desc-gone')).toBe(false);
  });

  it('adoption is a no-op when the entry is already canonical', async () => {
    rememberPendingVtuPurchase('desc-same', 'key-winner');
    const before = pendingPurchases.get('desc-same');

    await expect(
      adoptCanonicalVtuKey('desc-same', 'key-winner', 'key-winner')
    ).resolves.toBe(true);

    expect(pendingPurchases.get('desc-same')).toBe(before);
    expect(recallPendingVtuKey('desc-same')).toBe('key-winner');
  });

  it('adoption keeps the memory rebind and schedules a retry when the flush fails', async () => {
    // Codex R1 P1: storage outage during adoption — memory still
    // rebinds (live retries converge on the winner), false
    // reports the crash window (server-side loser mapping
    // backstops it), and the scheduled retry lands the winner
    // once storage works. Pins the navigator fallback (R149):
    // this jsdom's LockManager never releases a lock whose
    // callback throws.
    clearPendingVtuKeys();
    const g = globalThis as { navigator?: unknown };
    const priorNavigator = g.navigator;
    g.navigator = {};
    rememberPendingVtuPurchase('desc-flushfail', 'key-minted');
    const persistSpy = jest
      .spyOn(vtuStore, 'persistPendingVtuEntries')
      .mockReturnValue(false);
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      await expect(
        adoptCanonicalVtuKey('desc-flushfail', 'key-minted', 'key-winner')
      ).resolves.toBe(false);
      expect(recallPendingVtuKey('desc-flushfail')).toBe('key-winner');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/not durable/)
      );
    } finally {
      persistSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      g.navigator = priorNavigator;
    }
    // Storage works again: the scheduled retry persists the winner.
    await flushPendingVtuPurchases();
    const snapshot = parsePendingVtuSnapshot(vtuStore.loadPendingVtuSnapshot());
    expect(snapshot.entries).toEqual([
      ['desc-flushfail', expect.objectContaining({ key: 'key-winner' })],
    ]);
  });

  it('adoption no-ops when the live entry already moved generation', async () => {
    // Codex R2 P1 (local half): the descriptor was rebound since
    // this join response was issued — adopting the old winner
    // would resurrect a superseded generation.
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('desc-rotated', 'key-new');
    await flushPendingVtuPurchases();

    await expect(
      adoptCanonicalVtuKey('desc-rotated', 'key-minted', 'key-winner')
    ).resolves.toBe(true);

    expect(recallPendingVtuKey('desc-rotated')).toBe('key-new');
    const snapshot = parsePendingVtuSnapshot(vtuStore.loadPendingVtuSnapshot());
    expect(snapshot.entries).toEqual([
      ['desc-rotated', expect.objectContaining({ key: 'key-new' })],
    ]);
  });

  it('adoption no-ops without flushing when storage holds a newer generation', async () => {
    // Codex R2 P1 (cross-tab half): a sibling tab persisted a
    // newer same-descriptor key after this tab submitted — this
    // join response is stale. Flushing would overwrite the newer
    // key (memory-wins), orphaning its retry.
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('desc-stale', 'key-minted');
    // Drain the remember's scheduled flush BEFORE crafting the
    // sibling write, so nothing rewrites storage afterwards.
    await flushPendingVtuPurchases();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      vtuStore.savePendingVtuSnapshot(
        JSON.stringify({
          entries: [
            [
              'desc-stale',
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
      adoptCanonicalVtuKey('desc-stale', 'key-minted', 'key-winner')
    ).resolves.toBe(true);

    // No rebind, no flush: live memory and the newer persisted
    // generation both survive untouched.
    expect(recallPendingVtuKey('desc-stale')).toBe('key-minted');
    const snapshot = parsePendingVtuSnapshot(vtuStore.loadPendingVtuSnapshot());
    expect(snapshot.entries).toEqual([
      ['desc-stale', expect.objectContaining({ key: 'key-fresh' })],
    ]);
  });

  it('does not resurrect an entry forgotten while waiting for the lock', async () => {
    // CodeRabbit #3730: the rebind must re-read the live entry
    // under the lock — a synchronous forget during the lock wait
    // deletes the live entry, and rebinding the pre-lock copy
    // would resurrect it (the tombstone holds the loser key and
    // does not suppress the winner).
    rememberPendingVtuPurchase('desc-forgotten', 'key-minted');
    const real = vtuSync.runPendingVtuMintLocked;
    let forgot = false;
    const lockSpy = jest
      .spyOn(vtuSync, 'runPendingVtuMintLocked')
      .mockImplementation((async (callback: () => unknown) => {
        if (!forgot) {
          // Exactly once: later lock runs are scheduled flushes
          // sharing the runner. A repeat forget with empty memory
          // would note a keyless tombstone, whose timestamp
          // arbitration reaps even the winner — masking the bug
          // this test pins (a loser-bound tombstone does not
          // suppress the winner entry).
          forgot = true;
          forgetPendingVtuPurchase('desc-forgotten');
        }
        return real(callback);
      }) as typeof real);
    try {
      await expect(
        adoptCanonicalVtuKey('desc-forgotten', 'key-minted', 'key-winner')
      ).resolves.toBe(true);
    } finally {
      lockSpy.mockRestore();
    }

    expect(recallPendingVtuKey('desc-forgotten')).toBeNull();
    expect(pendingPurchases.has('desc-forgotten')).toBe(false);
    const snapshot = parsePendingVtuSnapshot(vtuStore.loadPendingVtuSnapshot());
    expect(snapshot.entries).toEqual([]);
  });

  it('retries the remaining attempts after a transient lock error', async () => {
    // Jules #3730 Medium: the catch inside the 3-attempt loop
    // must not break on the first throw — a transient lock
    // error would bypass the remaining retries and report
    // not-durable even though the next attempt would land.
    rememberPendingVtuPurchase('desc-throwonce', 'key-minted');
    // Drain the remember's scheduled flush BEFORE installing the
    // throw-once spy, so the adoption's lock run is the call
    // that throws (not a background flush sharing the runner).
    await flushPendingVtuPurchases();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const real = vtuSync.runPendingVtuMintLocked;
    let calls = 0;
    const lockSpy = jest
      .spyOn(vtuSync, 'runPendingVtuMintLocked')
      .mockImplementation((async (callback: () => unknown) => {
        calls += 1;
        if (calls === 1) {
          throw new Error('transient lock timeout');
        }
        return real(callback);
      }) as typeof real);
    try {
      await expect(
        adoptCanonicalVtuKey('desc-throwonce', 'key-minted', 'key-winner')
      ).resolves.toBe(true);
    } finally {
      lockSpy.mockRestore();
    }

    expect(calls).toBeGreaterThan(1);
    expect(recallPendingVtuKey('desc-throwonce')).toBe('key-winner');
    const snapshot = parsePendingVtuSnapshot(vtuStore.loadPendingVtuSnapshot());
    expect(snapshot.entries).toEqual([
      ['desc-throwonce', expect.objectContaining({ key: 'key-winner' })],
    ]);
  });
});
