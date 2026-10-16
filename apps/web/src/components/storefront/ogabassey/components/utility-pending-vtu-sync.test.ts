import { hashVtuScopeDescriptor } from '@baci/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingVtuKeys,
  forgetPendingVtuPurchase,
  getPendingVtuKey,
  hasNotedPendingVtuReference,
  isStalePendingVtuSuccess,
  notePendingVtuReference,
  PENDING_VTU_STALE_AFTER_MS,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from './utility-pending-idempotency';
import { scopePendingVtuSignature } from './utility-pending-vtu-scope';
import {
  acquirePendingVtuMintLock,
  clearPendingVtuMintLock,
  loadPendingVtuMintLock,
  loadPendingVtuSnapshot,
  PENDING_VTU_MINT_LOCK_NAME,
  PENDING_VTU_MINT_LOCK_TTL_MS,
  releasePendingVtuMintLock,
  savePendingVtuMintLock,
  savePendingVtuSnapshot,
} from './utility-pending-idempotency-store';
import { parsePendingVtuSnapshot } from './utility-pending-vtu-codec';
import {
  forgottenScopedKeys,
  hydratePendingVtuPurchases,
  pendingVtuPurchases,
  persistPendingVtuPurchases,
  runPendingVtuMintLocked,
  serializePendingVtuPurchases,
  syncPendingVtuPurchasesFromSnapshot,
} from './utility-pending-vtu-sync';

describe('utility-pending-vtu-sync', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
    clearPendingVtuMintLock();
  });

  it('recalls the pending key after a page reload', async () => {
    // Prod-shaped key: every caller scopes through the choke point
    // (digested), so the reload path must round-trip the digest.
    const scoped = scopePendingVtuSignature(
      'user-reload',
      'merchant-1',
      '{"reload":true}'
    );
    const key = await getPendingVtuKey(scoped);
    notePendingVtuReference(scoped, 'REF-RELOAD');

    // A reload re-executes the module with an empty map; the
    // localStorage entry must restore the pending purchase.
    vi.resetModules();
    const fresh = await import('./utility-pending-idempotency');

    expect(fresh.recallPendingVtuKey(scoped)).toBe(key);
    expect(fresh.hasNotedPendingVtuReference(scoped, 'REF-RELOAD')).toBe(true);
  });

  it('rewrites a legacy snapshot with digests on load', async () => {
    // Migrate-on-read must reach the disk: without a write-back an
    // abandoned entry keeps its plaintext identifiers at rest for
    // the full TTL (Codex R54 6rrFRH).
    const legacyEntry = 'merchant-1:user-1:{"phoneNumber":"08030000000"}';
    const legacyTombstone = 'merchant-1:user-1:{"phoneNumber":"08030000002"}';
    const rememberedAt = Date.now();
    savePendingVtuSnapshot(
      JSON.stringify({
        entries: [
          [
            legacyEntry,
            {
              key: 'key-legacy',
              reference: null,
              rememberedAt,
              completedAt: null,
            },
          ],
        ],
        forgotten: [{ scoped: legacyTombstone, forgottenAt: rememberedAt }],
      })
    );

    vi.resetModules();
    await import('./utility-pending-vtu-sync');

    const stored = loadPendingVtuSnapshot() ?? '';
    expect(stored).not.toContain('08030000000');
    expect(stored).not.toContain('merchant-1:user-1');
    const parsed = parsePendingVtuSnapshot(stored);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0][0]).toBe(hashVtuScopeDescriptor(legacyEntry));
    expect(parsed.entries[0][1].key).toBe('key-legacy');
    // The syncing persist preserves tombstones (a raw save would drop
    // them and resurrect cross-tab deletions).
    expect(parsed.forgotten).toHaveLength(1);
    expect(parsed.forgotten[0].scoped).toBe(
      hashVtuScopeDescriptor(legacyTombstone)
    );
  });

  it('leaves a digest snapshot untouched on load', async () => {
    // No legacy keys: no write. The TTL-expired entry proves it —
    // any persist would have pruned it, changing the bytes.
    const digest = hashVtuScopeDescriptor('m:u:{"a":1}');
    const staleDigest = hashVtuScopeDescriptor('m:u:{"stale":true}');
    const original = JSON.stringify({
      entries: [
        [
          digest,
          {
            key: 'key-fresh',
            reference: null,
            rememberedAt: Date.now(),
            completedAt: null,
          },
        ],
        [
          staleDigest,
          { key: 'key-stale', reference: null, rememberedAt: 1 },
        ],
      ],
      forgotten: [],
    });
    savePendingVtuSnapshot(original);

    vi.resetModules();
    await import('./utility-pending-vtu-sync');

    expect(loadPendingVtuSnapshot()).toBe(original);
  });

  it('recalls a key another tab persisted after this tab loaded', async () => {
    // Cross-tab sequential retry: tab B opened (empty map) before tab
    // A submitted. B's recall must merge the snapshot first, or B
    // mints a second key the route debits as a second transaction.
    savePendingVtuSnapshot(
      JSON.stringify([
        [
          'SIG-XTAB',
          { key: 'key-tab-a', reference: null, rememberedAt: Date.now() },
        ],
      ])
    );

    expect(recallPendingVtuKey('SIG-XTAB')).toBe('key-tab-a');
  });

  it('drops a locally-held entry another tab deleted (tombstone sync)', async () => {
    // Tab B holds SIG-DEL in memory while tab A completes it: A's
    // forget persists a snapshot WITHOUT the entry but WITH a
    // tombstone. B's next recall must drop its in-memory copy — if B
    // wrote it back, an identical purchase would replay the completed
    // transaction as a new success without a new debit.
    const key = await getPendingVtuKey('SIG-DEL');
    expect(recallPendingVtuKey('SIG-DEL')).toBe(key);

    savePendingVtuSnapshot(
      JSON.stringify({
        entries: [],
        forgotten: [{ scoped: 'SIG-DEL', forgottenAt: Date.now() }],
      })
    );

    expect(recallPendingVtuKey('SIG-DEL')).toBeUndefined();
    // B's next persist carries the tombstone but not the entry.
    await getPendingVtuKey('SIG-OTHER');
    const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot());
    expect(snapshot.entries.map(([scoped]) => scoped)).not.toContain(
      'SIG-DEL'
    );
    expect(snapshot.forgotten.map((t) => t.scoped)).toContain('SIG-DEL');
  });

  it('merges a re-remembered entry newer than its tombstone', async () => {
    // A forget followed by a same-scope resubmit: the new generation
    // (rememberedAt past the tombstone) must still merge in a third
    // tab, or it would mint fresh and double-debit.
    const now = Date.now();
    savePendingVtuSnapshot(
      JSON.stringify({
        entries: [
          [
            'SIG-NEW',
            { key: 'key-new', reference: null, rememberedAt: now },
          ],
        ],
        forgotten: [{ scoped: 'SIG-NEW', forgottenAt: now - 1000 }],
      })
    );

    expect(recallPendingVtuKey('SIG-NEW')).toBe('key-new');
  });

  it('hydration never clobbers a live attempt with the snapshot', async () => {
    rememberPendingVtuPurchase('SIG-LIVE', 'key-live');
    hydratePendingVtuPurchases(
      JSON.stringify([
        [
          'SIG-LIVE',
          { key: 'key-stale', reference: null, rememberedAt: Date.now() },
        ],
      ])
    );

    expect(recallPendingVtuKey('SIG-LIVE')).toBe('key-live');
  });

  it('hydration normalizes legacy rows without completion tracking', async () => {
    hydratePendingVtuPurchases(
      JSON.stringify([
        [
          'SIG-LEGACY',
          {
            key: 'key-legacy',
            reference: 'REF-LEGACY',
            rememberedAt: Date.now(),
          },
        ],
      ])
    );

    expect(recallPendingVtuKey('SIG-LEGACY')).toBe('key-legacy');
    // Absent completedAt restores as null: never stale, never crash.
    expect(
      isStalePendingVtuSuccess(
        'SIG-LEGACY',
        'REF-LEGACY',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(false);
  });

  it('forgetting persists a tombstone so other tabs drop the key', async () => {
    rememberPendingVtuPurchase('SIG-A', 'key-a');
    forgetPendingVtuPurchase('SIG-A');

    const parsed = parsePendingVtuSnapshot(loadPendingVtuSnapshot());

    expect(parsed.entries).toHaveLength(0);
    expect(parsed.forgotten.map((t) => t.scoped)).toContain('SIG-A');
  });

  it('serialization round-trips live entries with their settlement', async () => {
    rememberPendingVtuPurchase('SIG-A', 'key-a');
    notePendingVtuReference('SIG-A', 'REF-A');

    const parsed = parsePendingVtuSnapshot(serializePendingVtuPurchases());

    expect(parsed.entries.map(([scoped]) => scoped)).toContain('SIG-A');
    expect(pendingVtuPurchases.get('SIG-A')?.key).toBe('key-a');
  });

  it('merges another tab’s completion into the matching live entry', async () => {
    // Tab B imported tab A's key while processing, then A observed
    // completion. B's merge must pick up the settlement — otherwise B
    // replays the completed key past the window with completedAt null
    // and presents the old vend as a new purchase.
    const rememberedAt = Date.now();
    rememberPendingVtuPurchase('SIG-MERGE', 'key-shared');
    notePendingVtuReference('SIG-MERGE', 'REF-MERGE');
    const completedAt = rememberedAt + 1000;
    savePendingVtuSnapshot(
      JSON.stringify([
        [
          'SIG-MERGE',
          {
            key: 'key-shared',
            reference: 'REF-MERGE',
            rememberedAt,
            completedAt,
          },
        ],
      ])
    );

    // Any recall triggers the cross-tab merge.
    expect(recallPendingVtuKey('SIG-MERGE')).toBe('key-shared');
    expect(
      isStalePendingVtuSuccess(
        'SIG-MERGE',
        'REF-MERGE',
        completedAt + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
  });

  it('merges a reference another tab noted after this tab imported', async () => {
    rememberPendingVtuPurchase('SIG-REF', 'key-ref');
    savePendingVtuSnapshot(
      JSON.stringify([
        [
          'SIG-REF',
          {
            key: 'key-ref',
            reference: 'REF-LATE',
            rememberedAt: Date.now(),
          },
        ],
      ])
    );

    expect(recallPendingVtuKey('SIG-REF')).toBe('key-ref');
    expect(hasNotedPendingVtuReference('SIG-REF', 'REF-LATE')).toBe(true);
  });

  it('keeps the earliest completion when both tabs observed it', async () => {
    // First observation wins globally, not per tab: the stale window
    // must not extend because a second tab saw it later.
    const first = Date.now();
    rememberPendingVtuPurchase('SIG-EARLY', 'key-early');
    notePendingVtuReference('SIG-EARLY', 'REF-EARLY');
    pendingVtuPurchases.get('SIG-EARLY')!.completedAt = first;
    savePendingVtuSnapshot(
      JSON.stringify([
        [
          'SIG-EARLY',
          {
            key: 'key-early',
            reference: 'REF-EARLY',
            rememberedAt: first,
            completedAt: first + 60_000,
          },
        ],
      ])
    );

    expect(recallPendingVtuKey('SIG-EARLY')).toBe('key-early');
    expect(
      isStalePendingVtuSuccess(
        'SIG-EARLY',
        'REF-EARLY',
        first + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
  });

  it('ignores persisted settlement when the live key is a newer generation', async () => {
    // Same scope, different keys: the snapshot holds the OLD attempt
    // (e.g. tab A hasn't synced since this tab re-submitted). The
    // live generation wins; merging the old completion would poison
    // the new attempt's replay arbitration.
    rememberPendingVtuPurchase('SIG-GEN', 'key-new-gen');
    notePendingVtuReference('SIG-GEN', 'REF-NEW-GEN');
    savePendingVtuSnapshot(
      JSON.stringify([
        [
          'SIG-GEN',
          {
            key: 'key-old-gen',
            reference: 'REF-OLD-GEN',
            rememberedAt: Date.now(),
            completedAt: Date.now(),
          },
        ],
      ])
    );

    expect(recallPendingVtuKey('SIG-GEN')).toBe('key-new-gen');
    expect(hasNotedPendingVtuReference('SIG-GEN', 'REF-NEW-GEN')).toBe(true);
    expect(
      isStalePendingVtuSuccess(
        'SIG-GEN',
        'REF-NEW-GEN',
        Date.now() + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(false);
  });

  it('retains tombstones when the persist write fails, retrying on the next persist', async () => {
    localStorage.clear();
    await getPendingVtuKey('SIG-QUOTA');
    notePendingVtuReference('SIG-QUOTA', 'REF-QUOTA');
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded');
      });
    try {
      // The forget drops the live entry but the write fails: the
      // tombstone must stay in memory, suppressing the stale
      // snapshot entry (which still holds the completed purchase).
      forgetPendingVtuPurchase('SIG-QUOTA');
      expect(forgottenScopedKeys.size).toBe(1);
      expect(recallPendingVtuKey('SIG-QUOTA')).toBeUndefined();
    } finally {
      setItem.mockRestore();
    }
    // The next persist retries the write and now succeeds: the
    // snapshot carries the tombstone and memory clears it.
    persistPendingVtuPurchases();
    expect(forgottenScopedKeys.size).toBe(0);
    expect(
      parsePendingVtuSnapshot(loadPendingVtuSnapshot()).forgotten
    ).toHaveLength(1);
  });
});

describe('keyed tombstones (6rrMIj)', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
  });

  function seedLive(key: string, rememberedAt: number): void {
    pendingVtuPurchases.set('SIG-GEN', {
      key,
      reference: null,
      rememberedAt,
      completedAt: null,
    });
  }

  function saveTombstone(
    tombstone: Record<string, unknown>,
    entries: unknown[] = []
  ): void {
    savePendingVtuSnapshot(JSON.stringify({ entries, forgotten: [tombstone] }));
  }

  it('keeps a newer in-flight key under a foreign older-generation tombstone', async () => {
    // Codex R55 6rrMIj: tab A settled K1 (tombstone T1), then
    // started an identical purchase (live K2). Stale tab B handles
    // the old terminal result and tombstones K1 with a LATER clock
    // (T2). Timestamp-only arbitration would erase live K2 and its
    // retry would mint fresh and double-debit; the key binding
    // keeps K2.
    const now = Date.now();
    seedLive('key-K2', now);
    saveTombstone({ scoped: 'SIG-GEN', forgottenAt: now + 5000, key: 'key-K1' });

    syncPendingVtuPurchasesFromSnapshot();

    expect(recallPendingVtuKey('SIG-GEN')).toBe('key-K2');
  });

  it('deletes the live entry when the key matches, regardless of clock order', async () => {
    // Causality beats clocks: same key means the live entry IS the
    // deleted generation, even when the tombstone clock predates it
    // (skewed cross-tab clocks).
    const now = Date.now();
    seedLive('key-K1', now);
    saveTombstone({ scoped: 'SIG-GEN', forgottenAt: now - 5000, key: 'key-K1' });

    syncPendingVtuPurchasesFromSnapshot();

    expect(recallPendingVtuKey('SIG-GEN')).toBeUndefined();
  });

  it('falls back to timestamp arbitration for keyless tombstones', async () => {
    // Pre-binding snapshots carry no key: an older live entry is
    // still deleted (legacy behavior preserved through the deploy
    // window until old tabs reload).
    const now = Date.now();
    seedLive('key-K2', now);
    saveTombstone({ scoped: 'SIG-GEN', forgottenAt: now + 5000 });

    syncPendingVtuPurchasesFromSnapshot();

    expect(recallPendingVtuKey('SIG-GEN')).toBeUndefined();
  });

  it('still suppresses zombie same-generation entries', async () => {
    // Same key as the tombstone means the snapshot entry IS the
    // deleted generation: suppress even though only the timestamp
    // proves it predates the deletion.
    const now = Date.now();
    savePendingVtuSnapshot(
      JSON.stringify({
        entries: [
          [
            'SIG-GEN',
            {
              key: 'key-K1',
              reference: null,
              rememberedAt: now - 60_000,
              completedAt: null,
            },
          ],
        ],
        forgotten: [{ scoped: 'SIG-GEN', forgottenAt: now, key: 'key-K1' }],
      })
    );

    syncPendingVtuPurchasesFromSnapshot();

    expect(recallPendingVtuKey('SIG-GEN')).toBeUndefined();
  });

  it('merges a newer-generation entry older than a foreign tombstone', async () => {
    // Codex R61 6rtSNf: tab A settled K1 and minted K2, then stale
    // tab B forgot K1 with a later clock. Timestamp-only merge
    // would erase the active K2 and its retry would mint K3 and
    // debit again; the key binding retains K2.
    const now = Date.now();
    savePendingVtuSnapshot(
      JSON.stringify({
        entries: [
          [
            'SIG-GEN',
            {
              key: 'key-K2',
              reference: null,
              rememberedAt: now - 60_000,
              completedAt: null,
            },
          ],
        ],
        forgotten: [{ scoped: 'SIG-GEN', forgottenAt: now, key: 'key-K1' }],
      })
    );

    syncPendingVtuPurchasesFromSnapshot();

    expect(recallPendingVtuKey('SIG-GEN')).toBe('key-K2');
  });

  it('records the deleted key generation on forget', async () => {
    rememberPendingVtuPurchase('SIG-GEN', 'key-K1');
    forgetPendingVtuPurchase('SIG-GEN');

    const forgotten = parsePendingVtuSnapshot(loadPendingVtuSnapshot())
      .forgotten;
    expect(forgotten).toHaveLength(1);
    expect(forgotten[0]).toMatchObject({
      scoped: 'SIG-GEN',
      key: 'key-K1',
    });
  });

  it('serializes mint acquisition: a second contender waits out the budget (Codex R148 P1)', async () => {
    const first = acquirePendingVtuMintLock();
    if (!first) {
      throw new Error('first acquire must succeed on an empty lock');
    }
    // Tab B spins the ~250ms budget, then fails closed (null).
    expect(acquirePendingVtuMintLock()).toBeNull();
    releasePendingVtuMintLock(first);
    const second = acquirePendingVtuMintLock();
    if (!second) {
      throw new Error('acquire must succeed after release');
    }
    expect(second).not.toBe(first);
    releasePendingVtuMintLock(second);
  }, 10000);

  it('steals an expired lock immediately (Codex R148 P1)', async () => {
    savePendingVtuMintLock(
      'crashed-holder',
      Date.now() - PENDING_VTU_MINT_LOCK_TTL_MS - 50
    );
    const token = acquirePendingVtuMintLock();
    if (!token) {
      throw new Error('expired lock must be stealable');
    }
    releasePendingVtuMintLock(token);
  });

  it('releases only the holding token (Codex R148 P1)', async () => {
    const token = acquirePendingVtuMintLock();
    if (!token) {
      throw new Error('acquire must succeed on an empty lock');
    }
    releasePendingVtuMintLock('someone-else');
    expect(loadPendingVtuMintLock()?.token).toBe(token);
    releasePendingVtuMintLock(token);
    expect(loadPendingVtuMintLock()).toBeNull();
  });

  it('getPendingVtuKey fails closed while another tab holds the mint (Codex R148 P1)', async () => {
    savePendingVtuMintLock('tab-a', Date.now());
    // No key, no POST: the same storage-unavailable error as an
    // undurable remember (the retry re-recalls the winner's key).
    await expect(getPendingVtuKey('{"lock":"held"}')).rejects.toThrow(
      /Could not save this purchase/
    );
    clearPendingVtuMintLock();
    expect(typeof (await getPendingVtuKey('{"lock":"held"}'))).toBe('string');
  }, 10000);

  it('runs the mint under navigator.locks when available (Muse R149 M1)', async () => {
    // Immediate-grant mock: proves the primary path delegates to a
    // real mutex (bypassing the runner leaves request uncalled).
    const request = vi.fn(
      async (_name: string, callback: () => string) => callback()
    );
    Object.defineProperty(navigator, 'locks', {
      value: { request },
      configurable: true,
    });
    try {
      const key = await getPendingVtuKey('{"locks":"primary"}');
      expect(typeof key).toBe('string');
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith(
        PENDING_VTU_MINT_LOCK_NAME,
        expect.any(Function)
      );
      // Callback throws reject (never a sync throw, never a retry).
      await expect(
        runPendingVtuMintLocked(() => {
          throw new Error('undurable');
        })
      ).rejects.toThrow('undurable');
    } finally {
      // jsdom ships no navigator.locks: restore the absence.
      delete (navigator as { locks?: unknown }).locks;
    }
  });

  it('serializes simultaneous mints so both tabs share one key (Muse R149 M1)', async () => {
    // Queuing mock with genuine lock semantics: the second
    // request's callback cannot start until the first resolves.
    // Concurrent recall → mint triples must then yield one key.
    const queue: Array<() => void> = [];
    let running = false;
    const pump = () => {
      if (!running) {
        const next = queue.shift();
        if (next) {
          running = true;
          next();
        }
      }
    };
    const request = vi.fn(
      (_name: string, callback: () => string) =>
        new Promise<string>((resolve) => {
          queue.push(() => resolve(callback()));
          pump();
        }).finally(() => {
          running = false;
          pump();
        })
    );
    Object.defineProperty(navigator, 'locks', {
      value: { request },
      configurable: true,
    });
    try {
      const [tabA, tabB] = await Promise.all([
        await getPendingVtuKey('{"locks":"race"}'),
        await getPendingVtuKey('{"locks":"race"}'),
      ]);
      expect(tabA).toBe(tabB);
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      delete (navigator as { locks?: unknown }).locks;
    }
  });

  it('falls back to the storage lock without navigator.locks (Muse R149 M1)', async () => {
    expect(
      (navigator as { locks?: unknown }).locks
    ).toBeUndefined();
    // Fallback held → null (caller throws); released → runs fn.
    savePendingVtuMintLock('tab-a', Date.now());
    await expect(runPendingVtuMintLocked(() => 'k')).resolves.toBeNull();
    clearPendingVtuMintLock();
    await expect(runPendingVtuMintLocked(() => 'k')).resolves.toBe('k');
    // Fallback callback throws propagate (never retried unlocked).
    await expect(
      runPendingVtuMintLocked(() => {
        throw new Error('undurable');
      })
    ).rejects.toThrow('undurable');
    expect(loadPendingVtuMintLock()).toBeNull();
  }, 10000);
});
