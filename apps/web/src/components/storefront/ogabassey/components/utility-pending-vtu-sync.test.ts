import { hashVtuScopeDescriptor } from '@baci/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingVtuKeys,
  forgetPendingVtuPurchase,
  forgetPendingVtuPurchaseDurable,
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
  runPendingVtuMintLocked,
  savePendingVtuMintLock,
  savePendingVtuSnapshot,
} from './utility-pending-idempotency-store';
import { parsePendingVtuSnapshot } from './utility-pending-vtu-codec';
import {
  flushPendingVtuPurchases,
  hydratePendingVtuPurchases,
  isCurrentVtuGeneration,
  pendingVtuPurchases,
  persistPendingVtuPurchases,
  serializePendingVtuPurchases,
  syncPendingVtuPurchasesFromSnapshot,
} from './utility-pending-vtu-sync';
import {
  forgottenScopedKeys,
  noteForgottenVtuScope,
} from './utility-pending-vtu-tombstones';

// jsdom ships no navigator.locks, and the mint runner fails closed
// in multi-tab browsers without it (Codex R152 P1) — pin an
// immediate-grant mock so these tests exercise the locks path.
// Fail-closed tests delete it explicitly.
function mockNavigatorLocks(): void {
  Object.defineProperty(navigator, 'locks', {
    value: {
      request: async (_name: string, callback: () => unknown) => callback(),
    },
    configurable: true,
  });
}

describe('utility-pending-vtu-sync', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
    clearPendingVtuMintLock();
    mockNavigatorLocks();
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
    await flushPendingVtuPurchases();

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
    await flushPendingVtuPurchases();

    const forgotten = parsePendingVtuSnapshot(loadPendingVtuSnapshot())
      .forgotten;
    expect(forgotten).toHaveLength(1);
    expect(forgotten[0]).toMatchObject({
      scoped: 'SIG-GEN',
      key: 'key-K1',
    });
  });

  it('serializes mint acquisition: a second contender waits out the budget (Codex R148 P1)', async () => {
    const first = await acquirePendingVtuMintLock();
    if (!first) {
      throw new Error('first acquire must succeed on an empty lock');
    }
    // Tab B spins the ~250ms budget, then fails closed (null).
    expect(await acquirePendingVtuMintLock()).toBeNull();
    releasePendingVtuMintLock(first);
    const second = await acquirePendingVtuMintLock();
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
    const token = await acquirePendingVtuMintLock();
    if (!token) {
      throw new Error('expired lock must be stealable');
    }
    releasePendingVtuMintLock(token);
  });

  it('releases only the holding token (Codex R148 P1)', async () => {
    const token = await acquirePendingVtuMintLock();
    if (!token) {
      throw new Error('acquire must succeed on an empty lock');
    }
    releasePendingVtuMintLock('someone-else');
    expect(loadPendingVtuMintLock()?.token).toBe(token);
    releasePendingVtuMintLock(token);
    expect(loadPendingVtuMintLock()).toBeNull();
  });

  it('getPendingVtuKey fails closed without navigator.locks in a browser (Codex R152 P1)', async () => {
    // jsdom is a multi-tab browser shape (window + document) with no
    // locks: minting must refuse rather than risk a sibling-tab
    // double mint through the non-atomic storage fallback. The held
    // storage cell is irrelevant — the refusal happens first. (The
    // storage-held → storage-error path survives only for
    // single-threaded runtimes; see the mobile fallback tests.)
    delete (navigator as { locks?: unknown }).locks;
    savePendingVtuMintLock('tab-a', Date.now());
    try {
      await expect(getPendingVtuKey('{"lock":"held"}')).rejects.toThrow(
        /update your browser/
      );
    } finally {
      clearPendingVtuMintLock();
    }
  });

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
      // No exact count (R152 P1): remember() schedules a coalesced
      // background flush that re-locks — the name pin below is the
      // wiring proof.
      expect(request).toHaveBeenCalled();
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
      // Truly concurrent (no inner await): both triples race for the
      // lock and must still yield one shared key.
      const [tabA, tabB] = await Promise.all([
        getPendingVtuKey('{"locks":"race"}'),
        getPendingVtuKey('{"locks":"race"}'),
      ]);
      expect(tabA).toBe(tabB);
      // No exact count (R152 P1): each mint's scheduled background
      // flush re-locks on its own microtask.
      expect(request).toHaveBeenCalled();
    } finally {
      delete (navigator as { locks?: unknown }).locks;
    }
  });

  it('rejects the mint when navigator.locks is missing in a browser (Codex R152 P1)', async () => {
    delete (navigator as { locks?: unknown }).locks;
    expect((navigator as { locks?: unknown }).locks).toBeUndefined();
    // The storage fallback is unreachable here: multi-tab browsers
    // fail closed (the fallback serves only single-threaded
    // runtimes — protocol covered by the acquire tests above, runner
    // branch by the mobile fallback tests). Rejection, never sync.
    let syncThrew = false;
    let pending: Promise<unknown> | null = null;
    try {
      pending = runPendingVtuMintLocked(() => 'k');
    } catch {
      syncThrew = true;
    }
    expect(syncThrew).toBe(false);
    await expect(pending).rejects.toThrow(/update your browser/);
  });

  it('yields the event loop while waiting on a held mint (Muse R151 M1)', async () => {
    // A busy-spin would block the main thread for the full ~250ms
    // budget: the 10ms timer could only fire after acquisition
    // settles. Timer-polled waits yield, so the timer wins.
    savePendingVtuMintLock('tab-a', Date.now());
    const order: string[] = [];
    setTimeout(() => {
      order.push('timer');
    }, 10);
    await expect(acquirePendingVtuMintLock()).resolves.toBeNull();
    order.push('acquired');
    expect(order).toEqual(['timer', 'acquired']);
    clearPendingVtuMintLock();
  }, 10000);

  it('retries a background flush dropped to contention (Codex R153 P2)', async () => {
    // This nested block pins no locks: install them (the mint and
    // the flush both fail closed in a lockless jsdom browser).
    clearPendingVtuKeys();
    mockNavigatorLocks();
    const signature = scopePendingVtuSignature(
      'user-1',
      'merchant-1',
      '{"retry":true}'
    );
    await getPendingVtuKey(signature);
    await flushPendingVtuPurchases();
    // Drain the scheduled chain: only the noted mutation below may
    // consume the one-shot storage failure.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setItem.mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      notePendingVtuReference(signature, 'REF-RETRY');
      // No further mutations: the chain's own retry must land it
      // (pre-fix the single attempt dropped it here).
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      setItem.mockRestore();
    }

    const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot());
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.[1].reference).toBe('REF-RETRY');
  });

  it('lands terminal deletions before returning (Codex R153 P2)', async () => {
    clearPendingVtuKeys();
    mockNavigatorLocks();
    const sigScheduled = scopePendingVtuSignature(
      'user-1',
      'merchant-1',
      '{"d":1}'
    );
    const sigDurable = scopePendingVtuSignature(
      'user-1',
      'merchant-1',
      '{"d":2}'
    );
    await getPendingVtuKey(sigScheduled);
    await getPendingVtuKey(sigDurable);
    await flushPendingVtuPurchases();

    // Scheduled forget is NOT durable on return (the P2 window: a
    // pre-drain exit resurrects the active key for the next buyer).
    forgetPendingVtuPurchase(sigScheduled);
    expect(
      parsePendingVtuSnapshot(loadPendingVtuSnapshot()).entries.map(
        ([scoped]) => scoped
      )
    ).toContain(sigScheduled);

    // Durable forget is: memory drops AND the locked flush lands
    // before the result finalizes.
    await expect(
      forgetPendingVtuPurchaseDurable(sigDurable)
    ).resolves.toBe(true);
    const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot());
    expect(snapshot.entries.map(([scoped]) => scoped)).not.toContain(
      sigDurable
    );
    expect(snapshot.forgotten.map((tombstone) => tombstone.scoped)).toContain(
      sigDurable
    );
    expect(recallPendingVtuKey(sigDurable)).toBeUndefined();
  });

  it('absorbs transient write blips inside the durable forget (Codex R155 P2)', async () => {
    clearPendingVtuKeys();
    mockNavigatorLocks();
    const signature = scopePendingVtuSignature(
      'user-1',
      'merchant-1',
      '{"blip":true}'
    );
    await getPendingVtuKey(signature);
    await flushPendingVtuPurchases();
    // Drain the scheduled chain: only the durable attempts below may
    // consume the one-shot storage failures.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setItem.mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });
    setItem.mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      // Two attempts fail, the third lands: true, no scheduled retry.
      await expect(
        forgetPendingVtuPurchaseDurable(signature)
      ).resolves.toBe(true);
    } finally {
      setItem.mockRestore();
    }

    const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot());
    expect(snapshot.entries).toHaveLength(0);
    expect(snapshot.forgotten.map((tombstone) => tombstone.scoped)).toContain(
      signature
    );
  });

  it('reports persistent storage failure instead of claiming durability (Codex R155 P2)', async () => {
    clearPendingVtuKeys();
    mockNavigatorLocks();
    const signature = scopePendingVtuSignature(
      'user-1',
      'merchant-1',
      '{"broken":true}'
    );
    await getPendingVtuKey(signature);
    await flushPendingVtuPurchases();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    try {
      // All attempts fail: false (never a false true), memory still
      // drops so this tab stays exact, and the failure is logged.
      await expect(
        forgetPendingVtuPurchaseDurable(signature)
      ).resolves.toBe(false);
      expect(consoleError).toHaveBeenCalledWith(
        'VTU registry terminal forget not durable; retry scheduled.'
      );
      expect(recallPendingVtuKey(signature)).toBeUndefined();
    } finally {
      consoleError.mockRestore();
      setItem.mockRestore();
    }
  });

  it('keeps every generation tombstone for a scope until the next persist', () => {
    // Multi-key (CodeRabbit Major, mobile mirror): a non-durable
    // canonical adoption tombstones the persisted loser, then
    // terminal settlement tombstones the winner. Single-slot
    // replacement would drop the loser record and resurrect the
    // persisted loser on merge — both records must accumulate and
    // any matching record must suppress.
    const scoped = scopePendingVtuSignature(
      'user-multikey',
      'merchant-1',
      '{"multikey":true}'
    );
    rememberPendingVtuPurchase(scoped, 'key-loser');
    const now = Date.now();
    noteForgottenVtuScope(scoped, now, 'key-loser');
    noteForgottenVtuScope(scoped, now + 5, 'key-winner');

    // Both records ride the snapshot (one scope, two tombstones).
    const serialized = parsePendingVtuSnapshot(serializePendingVtuPurchases());
    expect(serialized.forgotten).toHaveLength(2);
    // Either generation's persisted entry is suppressed on merge.
    expect(
      syncSuppressesForTesting(scoped, 'key-loser', now - 1000)
    ).toBe(true);
    expect(
      syncSuppressesForTesting(scoped, 'key-winner', now - 1000)
    ).toBe(true);
    expect(
      syncSuppressesForTesting(scoped, 'key-other', now - 1000)
    ).toBe(false);

    function syncSuppressesForTesting(
      descriptor: string,
      key: string,
      rememberedAt: number
    ): boolean {
      pendingVtuPurchases.delete(descriptor);
      expect(
        savePendingVtuSnapshot(
          JSON.stringify({
            entries: [
              [
                descriptor,
                {
                  key,
                  reference: null,
                  rememberedAt,
                  completedAt: null,
                },
              ],
            ],
            forgotten: [],
          })
        )
      ).toBe(true);
      syncPendingVtuPurchasesFromSnapshot();
      return !pendingVtuPurchases.has(descriptor);
    }
  });

  it('vetoes a superseded generation and adopts the persisted newer one', () => {
    // Codex P1: a sibling tab settled and persisted a newer
    // same-descriptor generation after this tab adopted. The
    // caller must skip its stale note (noting would flush the
    // stale entry back over the newer generation), and memory
    // converges to the newer generation.
    const scoped = scopePendingVtuSignature(
      'user-veto',
      'merchant-1',
      '{"veto":true}'
    );
    rememberPendingVtuPurchase(scoped, 'key-old');
    const live = pendingVtuPurchases.get(scoped);
    expect(live).toBeDefined();
    expect(
      savePendingVtuSnapshot(
        JSON.stringify({
          entries: [
            [
              scoped,
              {
                key: 'key-new',
                reference: null,
                rememberedAt: (live?.rememberedAt ?? 0) + 1000,
                completedAt: null,
              },
            ],
          ],
          forgotten: [],
        })
      )
    ).toBe(true);

    expect(isCurrentVtuGeneration(scoped, 'key-old')).toBe(false);
    expect(recallPendingVtuKey(scoped)).toBe('key-new');
  });

  it('ignores a tombstoned persisted loser after a non-durable adoption', () => {
    // CodeRabbit Minor: adoption rebound memory to the winner
    // (keeping rememberedAt) but the flush failed, so the
    // snapshot still holds the loser — explicitly tombstoned.
    // The veto must not converge the loser back and veto the
    // winner's terminal settlement (unmarked winner).
    const scoped = scopePendingVtuSignature(
      'user-tombveto',
      'merchant-1',
      '{"tombveto":true}'
    );
    rememberPendingVtuPurchase(scoped, 'key-loser');
    persistPendingVtuPurchases();
    const live = pendingVtuPurchases.get(scoped);
    expect(live).toBeDefined();
    pendingVtuPurchases.set(scoped, { ...live!, key: 'key-winner' });
    noteForgottenVtuScope(scoped, Date.now(), 'key-loser');

    expect(isCurrentVtuGeneration(scoped, 'key-winner')).toBe(true);
    expect(recallPendingVtuKey(scoped)).toBe('key-winner');
  });

  it('reports current when memory holds the expected key and storage agrees', () => {
    const scoped = scopePendingVtuSignature(
      'user-current',
      'merchant-1',
      '{"current":true}'
    );
    rememberPendingVtuPurchase(scoped, 'key-mine');
    persistPendingVtuPurchases();

    expect(isCurrentVtuGeneration(scoped, 'key-mine')).toBe(true);
    expect(recallPendingVtuKey(scoped)).toBe('key-mine');
  });

  it('reports superseded when memory already rotated', () => {
    const scoped = scopePendingVtuSignature(
      'user-rotated',
      'merchant-1',
      '{"rotated":true}'
    );
    rememberPendingVtuPurchase(scoped, 'key-new');

    expect(isCurrentVtuGeneration(scoped, 'key-old')).toBe(false);
    // Nothing to reconcile — memory already moved on.
    expect(recallPendingVtuKey(scoped)).toBe('key-new');
  });
});
