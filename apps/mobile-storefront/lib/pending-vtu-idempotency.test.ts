import { buildPendingVtuScopeTag } from '@baci/shared';
import {
  buildVtuPurchaseDescriptor,
  scopePendingVtuKey,
} from './pending-vtu-descriptor';

let mockNextUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `uuid-${++mockNextUuid}`,
}));

import {
  clearPendingVtuKeys,
  forgetPendingVtuByReference,
  forgetPendingVtuPurchase,
  getPendingVtuKey,
  hasNotedPendingVtuReference,
  hydratePendingVtuPurchases,
  isStalePendingVtuSuccess,
  listNotedPendingVtuReferences,
  markPendingVtuCompleted,
  markSettledPendingVtuByReference,
  notePendingVtuReference,
  PENDING_VTU_STALE_AFTER_MS,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
  serializePendingVtuPurchases,
} from './pending-vtu-idempotency';
import * as vtuCodec from './pending-vtu-idempotency-codec';
import {
  PERSISTED_VTU_KEY_TTL_MS,
  parsePendingVtuSnapshot,
} from './pending-vtu-idempotency-codec';
import * as vtuStore from './pending-vtu-idempotency-store';
import { flushPendingVtuPurchases } from './pending-vtu-idempotency-sync';
import { noteForgottenVtuScopes } from './pending-vtu-tombstones';

describe('pending-vtu-idempotency', () => {
  // Suite-level isolation (Muse R123 low): the MMKV mock buckets
  // persist across tests in a file, so a test that forgets its
  // manual clear would leak a retained key into the next test.
  // The escape hatch clears both the in-memory registry and the
  // persisted snapshot; per-test manual clears stay as documentation.
  beforeEach(() => {
    clearPendingVtuKeys();
    vtuStore.clearPendingVtuMintLock();
  });

  it('recalls a remembered key and forgets it on demand', () => {
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 1,
      phoneNumber: 'recall-me',
    });
    expect(recallPendingVtuKey(descriptor)).toBeNull();
    rememberPendingVtuPurchase(descriptor, 'key-1');
    expect(recallPendingVtuKey(descriptor)).toBe('key-1');
    forgetPendingVtuPurchase(descriptor);
    expect(recallPendingVtuKey(descriptor)).toBeNull();
  });

  it('flags a success replay as stale only past the recall window', () => {
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 2,
      phoneNumber: 'stale-check',
    });
    const rememberedAt = Date.now();
    rememberPendingVtuPurchase(descriptor, 'key-stale');
    notePendingVtuReference(descriptor, 'REF-OLD');
    // Noted but never completed: never stale, however old the submit.
    expect(
      isStalePendingVtuSuccess(
        descriptor,
        'REF-OLD',
        rememberedAt + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(false);

    markPendingVtuCompleted(descriptor, rememberedAt);
    expect(isStalePendingVtuSuccess(descriptor, 'REF-OLD', rememberedAt)).toBe(
      false
    );
    expect(
      isStalePendingVtuSuccess(
        descriptor,
        'REF-OLD',
        rememberedAt + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
    // A different reference is a different transaction, never stale.
    expect(
      isStalePendingVtuSuccess(
        descriptor,
        'REF-NEW',
        rememberedAt + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(false);
  });

  it('presents a slow first completion instead of aging the submit', () => {
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 3,
      phoneNumber: 'slow-check',
    });
    const submittedAt = Date.now();
    rememberPendingVtuPurchase(descriptor, 'key-slow');
    notePendingVtuReference(descriptor, 'REF-SLOW');

    const completedAt = submittedAt + PENDING_VTU_STALE_AFTER_MS + 60_000;
    markPendingVtuCompleted(descriptor, completedAt);
    expect(
      isStalePendingVtuSuccess(descriptor, 'REF-SLOW', completedAt + 1000)
    ).toBe(false);
    expect(
      isStalePendingVtuSuccess(
        descriptor,
        'REF-SLOW',
        completedAt + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
  });

  it('keeps the first completion when re-marked', () => {
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 4,
      phoneNumber: 'remark-check',
    });
    rememberPendingVtuPurchase(descriptor, 'key-remark');
    notePendingVtuReference(descriptor, 'REF-1');
    const first = Date.now();
    markPendingVtuCompleted(descriptor, first);
    markPendingVtuCompleted(descriptor, first + 10_000);

    expect(
      isStalePendingVtuSuccess(
        descriptor,
        'REF-1',
        first + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
  });

  it('forgets retained entries by noted reference on terminal history', () => {
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 4,
      phoneNumber: 'settle-check',
    });
    rememberPendingVtuPurchase(descriptor, 'key-settle');
    notePendingVtuReference(descriptor, 'REF-SETTLE');

    // Unknown references touch nothing.
    forgetPendingVtuByReference('REF-OTHER');
    expect(recallPendingVtuKey(descriptor)).toBe('key-settle');

    // Observed terminality forgets: the success is shown, so an
    // identical repeat is a new intent that must mint fresh and
    // deliver anew — keeping the key would present the previous vend
    // as the new purchase without delivering anything.
    forgetPendingVtuByReference('REF-SETTLE');

    expect(recallPendingVtuKey(descriptor)).toBeNull();
  });

  it('marks background-settled successes stale without deleting them', () => {
    // Codex R68 6rwG9F: the outcome was never shown in-session, so
    // the retry must be told "Already Completed" — not silently
    // double-charge on a fresh key.
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 4,
      phoneNumber: 'mark-settle-check',
    });
    rememberPendingVtuPurchase(descriptor, 'key-mark-settle');
    notePendingVtuReference(descriptor, 'REF-MARK-SETTLE');

    markSettledPendingVtuByReference('REF-OTHER');
    expect(recallPendingVtuKey(descriptor)).toBe('key-mark-settle');

    markSettledPendingVtuByReference('REF-MARK-SETTLE');

    expect(recallPendingVtuKey(descriptor)).toBe('key-mark-settle');
    expect(isStalePendingVtuSuccess(descriptor, 'REF-MARK-SETTLE')).toBe(true);
  });

  it('skips already-marked entries when settling by reference', () => {
    // Codex R68 6rwG9F: suppressed completions keep their fresh mark
    // so the stale guard presents them on replay.
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 4,
      phoneNumber: 'mark-skip-check',
    });
    rememberPendingVtuPurchase(descriptor, 'key-mark-skip');
    notePendingVtuReference(descriptor, 'REF-MARK-SKIP');
    markPendingVtuCompleted(descriptor);

    markSettledPendingVtuByReference('REF-MARK-SKIP');

    expect(recallPendingVtuKey(descriptor)).toBe('key-mark-skip');
    expect(isStalePendingVtuSuccess(descriptor, 'REF-MARK-SKIP')).toBe(false);
  });

  it('routes completion durability through the locked flush (Codex R153 P1, web mirror)', async () => {
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('mob-routed', 'key-routed');
    notePendingVtuReference('mob-routed', 'REF-ROUTED');
    await flushPendingVtuPurchases();
    markPendingVtuCompleted('mob-routed');

    // Memory updates synchronously (completed entries leave the list).
    expect(listNotedPendingVtuReferences()).toEqual([]);
    // But nothing is written synchronously — the old direct persist
    // ran its merge + write outside the mutex, clobbering a sibling.
    const before = parsePendingVtuSnapshot(vtuStore.loadPendingVtuSnapshot());
    expect(before.entries).toHaveLength(1);
    expect(before.entries[0][1].completedAt).toBeNull();

    await flushPendingVtuPurchases();

    const after = parsePendingVtuSnapshot(vtuStore.loadPendingVtuSnapshot());
    expect(after.entries).toHaveLength(1);
    expect(after.entries[0][1].completedAt).not.toBeNull();
  });

  it('recognizes a noted reference independently of completion', () => {
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 5,
      phoneNumber: 'noted-check',
    });
    rememberPendingVtuPurchase(descriptor, 'key-noted');

    expect(hasNotedPendingVtuReference(descriptor, 'REF-1')).toBe(false);
    notePendingVtuReference(descriptor, 'REF-1');
    expect(hasNotedPendingVtuReference(descriptor, 'REF-1')).toBe(true);
    expect(hasNotedPendingVtuReference(descriptor, 'REF-OTHER')).toBe(false);
  });

  it('never flags a reference-less entry as stale', () => {
    // The user saw failure (any response would have finalized the
    // entry), so a re-tap is definitionally a retry at any age:
    // reusing the key lets the server dedupe, while forcing stale
    // would mint a fresh key and double-debit a slow retry of an
    // already-committed attempt.
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'data',
      amount: 3,
      phoneNumber: 'no-ref-yet',
    });
    const rememberedAt = Date.now();
    rememberPendingVtuPurchase(descriptor, 'key-noref');
    expect(
      isStalePendingVtuSuccess(
        descriptor,
        'REF-FIRST',
        rememberedAt + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(false);
  });

  it('retains TTL-aged unanswered entries on recall', () => {
    // Codex R63 6ruGlp: a lost response leaves the reference null
    // after a possibly-committed debit — dropping the key would mint
    // fresh on retry and debit twice. Only completed entries drop.
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 9,
      phoneNumber: 'ttl-unanswered',
    });
    rememberPendingVtuPurchase(descriptor, 'key-ttl');
    const expired = Date.now() + PERSISTED_VTU_KEY_TTL_MS + 1;
    expect(recallPendingVtuKey(descriptor, expired)).toBe('key-ttl');

    const doneDescriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 9,
      phoneNumber: 'ttl-done',
    });
    rememberPendingVtuPurchase(doneDescriptor, 'key-done');
    const doneAt = Date.now();
    markPendingVtuCompleted(doneDescriptor, doneAt);
    expect(
      recallPendingVtuKey(doneDescriptor, doneAt + PERSISTED_VTU_KEY_TTL_MS + 1)
    ).toBeNull();
    // Deletion sticks: a live recall also misses.
    expect(recallPendingVtuKey(doneDescriptor)).toBeNull();
  });

  it('retains TTL-aged referenced entries on recall', () => {
    // Codex R61 6rtSNk: dropping the key mapping for a referenced but
    // never-terminally-observed entry would make the retry mint fresh
    // and debit again while the first charge is still processing.
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 10,
      phoneNumber: 'ttl-ref',
    });
    rememberPendingVtuPurchase(descriptor, 'key-ttl-ref');
    notePendingVtuReference(descriptor, 'REF-TTL');
    const expired = Date.now() + PERSISTED_VTU_KEY_TTL_MS + 1;
    expect(recallPendingVtuKey(descriptor, expired)).toBe('key-ttl-ref');
    // Retention sticks: a live recall still hits.
    expect(recallPendingVtuKey(descriptor)).toBe('key-ttl-ref');
  });

  it('overflows past the cap rather than evicting live attempts', () => {
    // Evicting a live (unconfirmed) entry would lose deduplication:
    // retrying it would mint fresh and double-debit. Only past-TTL
    // entries are eviction victims; live overflow is cheap and the
    // 7-day TTL bounds retention.
    // Deterministic fixtures only (no Date.now/Math.random): the loop
    // index already guarantees uniqueness.
    const descriptors = Array.from(
      { length: 40 },
      (_, index) => `evict-${index}-fixed`
    );
    for (const descriptor of descriptors) {
      rememberPendingVtuPurchase(descriptor, `key-${descriptor}`);
    }
    expect(recallPendingVtuKey(descriptors[0])).toBe(`key-${descriptors[0]}`);
    expect(recallPendingVtuKey(descriptors[descriptors.length - 1])).toBe(
      `key-${descriptors[descriptors.length - 1]}`
    );
  });

  it('keeps stale referenced entries past the cap (no live victim exists)', () => {
    // Staleness is deliberately NOT a victim criterion: a referenced
    // entry older than five minutes may still be processing, and the
    // stale branch needs its key. With every entry live, the 33rd
    // remember overflows instead of evicting.
    clearPendingVtuKeys();
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      for (let index = 0; index < 32; index++) {
        rememberPendingVtuPurchase(`cap-${index}`, `key-${index}`);
      }
      notePendingVtuReference('cap-31', 'REF-OLD');
      jest.setSystemTime(
        new Date('2026-01-01T00:00:00Z').getTime() +
          PENDING_VTU_STALE_AFTER_MS +
          1000
      );
      rememberPendingVtuPurchase('cap-new', 'key-new');
      // Stale-but-referenced survivor kept…
      expect(recallPendingVtuKey('cap-31')).toBe('key-31');
      // …oldest live entry kept too (overflow, not eviction)…
      expect(recallPendingVtuKey('cap-0')).toBe('key-0');
      expect(recallPendingVtuKey('cap-new')).toBe('key-new');
    } finally {
      jest.useRealTimers();
    }
  });

  it('retains referenced-processing past-TTL entries at the cap (overflow)', () => {
    // Codex R61 6rtSNk + R63 6ruGlp: sig-old is uncompleted, so the
    // cap cannot evict it — eviction would lose the original key and
    // the retry would double-debit. Only the completed aged entry is
    // a victim; sig-old overflows instead.
    clearPendingVtuKeys();
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      rememberPendingVtuPurchase('sig-old', 'key-old');
      notePendingVtuReference('sig-old', 'REF-OLD');
      rememberPendingVtuPurchase('sig-done', 'key-done');
      markPendingVtuCompleted('sig-done');
      jest.setSystemTime(
        new Date('2026-01-01T00:00:00Z').getTime() +
          PERSISTED_VTU_KEY_TTL_MS -
          60 * 1000
      );
      for (let index = 0; index < 31; index++) {
        rememberPendingVtuPurchase(`live-${index}`, `key-${index}`);
      }
      jest.setSystemTime(
        new Date('2026-01-01T00:00:00Z').getTime() +
          PERSISTED_VTU_KEY_TTL_MS +
          1000
      );
      rememberPendingVtuPurchase('live-new', 'key-new');
      // Completed aged victim evicted…
      expect(recallPendingVtuKey('sig-done')).toBeNull();
      // …TTL-aged referenced-processing entry retained (overflow)…
      expect(recallPendingVtuKey('sig-old')).toBe('key-old');
      // …young survivors kept.
      expect(recallPendingVtuKey('live-0')).toBe('key-0');
      expect(recallPendingVtuKey('live-new')).toBe('key-new');
    } finally {
      jest.useRealTimers();
    }
  });

  it('isolates remembered keys by scoped owner', () => {
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 7,
      phoneNumber: 'scope-recall',
    });
    const keyA = scopePendingVtuKey('customer-a', 'merchant-1', descriptor);
    const keyB = scopePendingVtuKey('customer-b', 'merchant-1', descriptor);
    rememberPendingVtuPurchase(keyA, 'key-a');

    // A second customer with the same purchase must not recall it…
    expect(recallPendingVtuKey(keyB)).toBeNull();
    // …and forgetting under the wrong scope must not drop it.
    forgetPendingVtuPurchase(keyB);
    expect(recallPendingVtuKey(keyA)).toBe('key-a');
  });

  it('restores the pending key after an app restart', () => {
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 9,
      phoneNumber: 'restart-me',
    });
    const scoped = scopePendingVtuKey('user-a', 'merchant-1', descriptor);
    rememberPendingVtuPurchase(scoped, 'restart-key');
    notePendingVtuReference(scoped, 'REF-RESTART');

    // A restart re-executes the module with an empty map; the MMKV
    // snapshot taken at persist time must restore the pendings. The
    // init path calls hydrate with the stored snapshot, so round-trip
    // through the same functions against a fresh module instance.
    const snapshot = serializePendingVtuPurchases();
    jest.resetModules();
    const fresh = jest.requireActual<
      typeof import('./pending-vtu-idempotency')
    >('./pending-vtu-idempotency');
    fresh.hydratePendingVtuPurchases(snapshot);

    expect(fresh.recallPendingVtuKey(scoped)).toBe('restart-key');
    expect(fresh.isStalePendingVtuSuccess(scoped, 'REF-RESTART')).toBe(false);
  });

  it('does not resurrect a forgotten entry whose tombstone reached the snapshot', () => {
    clearPendingVtuKeys();
    const now = Date.now();
    const scoped = scopePendingVtuKey('user-a', 'merchant-1', 'SIG-DEAD');
    // A snapshot written while the deletion was still retrying: the
    // stale entry row plus its tombstone. Hydrate must suppress the
    // entry, or an identical purchase replays the old vend as new.
    hydratePendingVtuPurchases(
      JSON.stringify({
        entries: [
          [
            scoped,
            {
              key: 'dead-key',
              reference: 'REF-DEAD',
              rememberedAt: now - 2000,
              completedAt: now - 1000,
            },
          ],
        ],
        forgotten: [{ scoped, forgottenAt: now - 1000 }],
      })
    );

    expect(recallPendingVtuKey(scoped)).toBeNull();
  });

  it('restores a re-remembered entry newer than its tombstone', () => {
    clearPendingVtuKeys();
    const now = Date.now();
    const scoped = scopePendingVtuKey('user-a', 'merchant-1', 'SIG-REBORN');
    hydratePendingVtuPurchases(
      JSON.stringify({
        entries: [
          [
            scoped,
            {
              key: 'new-key',
              reference: null,
              rememberedAt: now,
              completedAt: null,
            },
          ],
        ],
        forgotten: [{ scoped, forgottenAt: now - 1000 }],
      })
    );

    expect(recallPendingVtuKey(scoped)).toBe('new-key');
  });

  it('carries noted tombstones in the next snapshot', () => {
    clearPendingVtuKeys();
    const scoped = scopePendingVtuKey('user-a', 'merchant-1', 'SIG-NOTED');
    rememberPendingVtuPurchase(scoped, 'noted-key');
    forgetPendingVtuPurchase(scoped);

    // The forget's own persist cleared its tombstone (the root
    // MMKV mock is memory-backed, so the write succeeds); re-note
    // to prove the registry→snapshot plumbing directly.
    // Multi-key (CodeRabbit Major): the re-noted keyless record
    // accumulates alongside the forget's keyed record instead of
    // replacing it — both ride the snapshot.
    noteForgottenVtuScopes([scoped], Date.now());
    const snapshot = parsePendingVtuSnapshot(serializePendingVtuPurchases());

    expect(snapshot.entries).toEqual([]);
    expect(snapshot.forgotten).toHaveLength(2);
    expect(snapshot.forgotten.map((t) => t.key)).toContain('noted-key');
    expect(recallPendingVtuKey(scoped)).toBeNull();
  });

  it('clears a retained tombstone when a new generation is remembered', async () => {
    // Codex R94 P2: the forget's MMKV write failed, so its tombstone
    // stayed in memory (re-noted here — writes trivially succeed
    // under jest); the gated submit then remembered a new key in the
    // same millisecond (forgottenAt >= rememberedAt). Without the
    // clear-on-remember, the restart parse suppresses the new entry
    // and the retry mints another UUID — a second debit/vend risk.
    clearPendingVtuKeys();
    const scoped = scopePendingVtuKey('user-a', 'merchant-1', 'SIG-REBORN-MS');
    rememberPendingVtuPurchase(scoped, 'old-key');
    // Capture the exact bytes each persist writes: the remember's own
    // persist clears the in-memory tombstones on success, so the
    // written snapshot is the only observable difference. Spy via the
    // top-level namespace (the same instance our registry imports —
    // requireActual would miss after an earlier resetModules).
    const serializeSpy = jest.spyOn(vtuCodec, 'serializePendingVtuEntries');
    // Pin the clock: the forget and the re-remember land in the SAME
    // millisecond (forgottenAt >= rememberedAt), the collision the
    // verdict describes.
    const now = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      forgetPendingVtuPurchase(scoped, now);
      // Persist the tombstone first (R152 P1: forget only schedules
      // now): the re-remember's flush-time sync re-adopts it, and
      // the adopted tombstone rides the new snapshot binding
      // old-key — so it cannot suppress the same-millisecond new
      // generation (Codex R143 P1).
      await flushPendingVtuPurchases();
      rememberPendingVtuPurchase(scoped, 'new-key');
      await flushPendingVtuPurchases();
    } finally {
      nowSpy.mockRestore();
    }
    expect(recallPendingVtuKey(scoped)).toBe('new-key');

    const snapshots = serializeSpy.mock.results.map((result) =>
      parsePendingVtuSnapshot(result.value as string)
    );
    const rememberSnapshot = serializeSpy.mock.results.at(-1)?.value as string;
    serializeSpy.mockRestore();
    const written = snapshots.find(
      (snapshot) =>
        snapshot.entries.length === 1 && snapshot.forgotten.length === 1
    );
    expect(written?.forgotten).toEqual([
      expect.objectContaining({ forgottenAt: now, key: 'old-key' }),
    ]);
    expect(written?.entries).toHaveLength(1);

    // And a restart restores the new key instead of suppressing it.
    jest.resetModules();
    const fresh = jest.requireActual<
      typeof import('./pending-vtu-idempotency')
    >('./pending-vtu-idempotency');
    fresh.hydratePendingVtuPurchases(rememberSnapshot);
    expect(fresh.recallPendingVtuKey(scoped)).toBe('new-key');
  });

  it('drops a remembered entry the store cannot durably persist', async () => {
    // Codex R96 P1 (web mirror): a failed MMKV write must not hand
    // out a memory-only key — a restart would lose it and the retry
    // mint fresh and double-debit on ambiguous results. The mint
    // triple's inline persist fails, so it throws and rolls back the
    // memory admission; the retry re-mints once storage works.
    // (Durability moved from remember() to the triple, R152 P1.)
    // Pins the fallback: this jsdom's LockManager never releases a
    // lock whose callback throws, so a throw through the real
    // manager would wedge every later mint in this file (R149).
    clearPendingVtuKeys();
    const g = globalThis as { navigator?: unknown };
    const priorNavigator = g.navigator;
    g.navigator = {};
    const persistSpy = jest
      .spyOn(vtuStore, 'persistPendingVtuEntries')
      .mockReturnValue(false);
    try {
      await expect(getPendingVtuKey('mob-nopersist')).rejects.toThrow(
        /Could not save this purchase/
      );
      expect(recallPendingVtuKey('mob-nopersist')).toBeNull();
    } finally {
      persistSpy.mockRestore();
      g.navigator = priorNavigator;
    }
    // Storage works again: the retry mints normally.
    const retry = await getPendingVtuKey('mob-nopersist');
    expect(recallPendingVtuKey('mob-nopersist')).toBe(retry);
  });

  it('restores the tombstone when the replacement persist fails', async () => {
    // Codex R99 P2 (web mirror): consecutive write failures — the
    // forget's persist failed (old key still in storage, tombstone
    // memory-only) and now the replacement mint's inline save fails
    // too. Dropping the new entry without restoring the tombstone
    // would let a restart hydrate the stale key and replay the
    // previous successful vend as new, without debit or delivery.
    // (Rollback moved from remember() to the mint triple, R152 P1.)
    // Pins the fallback (R149): this jsdom's LockManager never
    // releases a lock whose callback throws.
    clearPendingVtuKeys();
    const g = globalThis as { navigator?: unknown };
    const priorNavigator = g.navigator;
    g.navigator = {};
    rememberPendingVtuPurchase('mob-tomb', 'key-old');
    await flushPendingVtuPurchases();
    const persistSpy = jest
      .spyOn(vtuStore, 'persistPendingVtuEntries')
      .mockReturnValue(false);
    try {
      // The forget's persist fails: storage still holds the old key
      // and the tombstone exists only in memory (the store clears
      // memory tombstones only after a durable write).
      forgetPendingVtuPurchase('mob-tomb');
      await expect(getPendingVtuKey('mob-tomb')).rejects.toThrow(
        /Could not save this purchase/
      );
      expect(recallPendingVtuKey('mob-tomb')).toBeNull();
      // The tombstone rides the next snapshot instead of being lost.
      const snapshot = parsePendingVtuSnapshot(serializePendingVtuPurchases());
      expect(snapshot.entries).toHaveLength(0);
      expect(snapshot.forgotten.map((t) => t.scoped)).toEqual(['mob-tomb']);
    } finally {
      persistSpy.mockRestore();
      g.navigator = priorNavigator;
    }
    // Storage works again: the retry supersedes the tombstone.
    const retry = await getPendingVtuKey('mob-tomb');
    expect(recallPendingVtuKey('mob-tomb')).toBe(retry);
    // Drain: the supersede's tombstone clear lands on flush.
    await flushPendingVtuPurchases();
    expect(
      parsePendingVtuSnapshot(serializePendingVtuPurchases()).forgotten
    ).toEqual([]);
  });

  it('lists noted references deduped, excluding unanswered entries', () => {
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('mob-l1', 'key-l1');
    notePendingVtuReference('mob-l1', 'REF-SHARED');
    rememberPendingVtuPurchase('mob-l2', 'key-l2');
    notePendingVtuReference('mob-l2', 'REF-SHARED');
    rememberPendingVtuPurchase('mob-l3', 'key-l3');

    expect(listNotedPendingVtuReferences()).toEqual(['REF-SHARED']);
  });

  it('filters noted references by scope tag, failing open untagged', () => {
    // Codex R62 6rtokd: the settle pass must not burn history reads
    // on another account's references. Untagged (pre-tag) entries
    // fail open — their owner is unknowable.
    clearPendingVtuKeys();
    const mine = buildPendingVtuScopeTag('user-1', 'merchant-1');
    const theirs = buildPendingVtuScopeTag('user-2', 'merchant-1');
    rememberPendingVtuPurchase('mob-a', 'key-a', mine);
    notePendingVtuReference('mob-a', 'REF-A');
    rememberPendingVtuPurchase('mob-b', 'key-b', theirs);
    notePendingVtuReference('mob-b', 'REF-B');
    rememberPendingVtuPurchase('mob-c', 'key-c');
    notePendingVtuReference('mob-c', 'REF-C');

    expect(listNotedPendingVtuReferences(mine).sort()).toEqual([
      'REF-A',
      'REF-C',
    ]);
    expect(listNotedPendingVtuReferences(theirs).sort()).toEqual([
      'REF-B',
      'REF-C',
    ]);
    expect(listNotedPendingVtuReferences().sort()).toEqual([
      'REF-A',
      'REF-B',
      'REF-C',
    ]);
  });

  it('recalls a key a sibling Expo web tab persisted without a restart (Codex R143 P1)', () => {
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 1,
      phoneNumber: 'sibling-tab',
    });
    const scoped = scopePendingVtuKey('user-a', 'merchant-1', descriptor);
    // Sibling tab's snapshot lands in shared storage while this tab's
    // memory is empty (beforeEach cleared both; only storage reseeds).
    vtuStore.savePendingVtuSnapshot(
      vtuCodec.serializePendingVtuEntries(
        [
          [
            scoped,
            {
              key: 'key-sibling',
              reference: null,
              rememberedAt: Date.now(),
              completedAt: null,
            },
          ],
        ],
        []
      )
    );

    // Without the recall-time sync this returns null and the retry
    // mints fresh — the server debits a second transaction.
    expect(recallPendingVtuKey(scoped)).toBe('key-sibling');
  });

  it('preserves a sibling tab entry when persisting its own (Codex R143 P1)', async () => {
    const descriptorA = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 2,
      phoneNumber: 'sibling-a',
    });
    const scopedA = scopePendingVtuKey('user-a', 'merchant-1', descriptorA);
    vtuStore.savePendingVtuSnapshot(
      vtuCodec.serializePendingVtuEntries(
        [
          [
            scopedA,
            {
              key: 'key-a',
              reference: null,
              rememberedAt: Date.now(),
              completedAt: null,
            },
          ],
        ],
        []
      )
    );

    const descriptorB = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 3,
      phoneNumber: 'sibling-b',
    });
    rememberPendingVtuPurchase(
      scopePendingVtuKey('user-a', 'merchant-1', descriptorB),
      'key-b'
    );
    await flushPendingVtuPurchases();

    // Without the persist-time sync the snapshot holds only key-b and
    // the sibling key is unrecoverable after a restart.
    const snapshot = vtuCodec.parsePendingVtuSnapshot(
      vtuStore.loadPendingVtuSnapshot()
    );
    expect(snapshot.entries.map(([, entry]) => entry.key).sort()).toEqual([
      'key-a',
      'key-b',
    ]);
  });

  it('getPendingVtuKey recalls retained keys and fails closed under a held mint (Codex R148 P1)', async () => {
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 5,
      phoneNumber: 'mint-lock',
    });
    const scoped = scopePendingVtuKey('user-a', 'merchant-1', descriptor);

    const first = await getPendingVtuKey(scoped);
    expect(typeof first).toBe('string');
    // Same descriptor recalls the retained key (no fresh mint).
    expect(await getPendingVtuKey(scoped)).toBe(first);

    // Sibling tab holds the mint: fail closed with the storage
    // error (no key, no POST) instead of minting a second key.
    // Pins the fallback: this jest env ships a real LockManager,
    // which (correctly) ignores the storage fallback cell.
    const g = globalThis as { navigator?: unknown };
    const priorNavigator = g.navigator;
    g.navigator = {};
    try {
      vtuStore.savePendingVtuMintLock('tab-a', Date.now());
      await expect(getPendingVtuKey(scoped)).rejects.toThrow(
        /Could not save this purchase/
      );
    } finally {
      vtuStore.clearPendingVtuMintLock();
      g.navigator = priorNavigator;
    }
    expect(await getPendingVtuKey(scoped)).toBe(first);
  }, 10000);

  it('merges sibling-tab reference knowledge into the live same-key entry (Codex R143 P1)', () => {
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 4,
      phoneNumber: 'sibling-ref',
    });
    const scoped = scopePendingVtuKey('user-a', 'merchant-1', descriptor);
    rememberPendingVtuPurchase(scoped, 'key-live');
    // Sibling observed the provider reference after this tab imported
    // the key; storage now knows more than live memory.
    vtuStore.savePendingVtuSnapshot(
      vtuCodec.serializePendingVtuEntries(
        [
          [
            scoped,
            {
              key: 'key-live',
              reference: 'REF-SIBLING',
              rememberedAt: Date.now() - 1000,
              completedAt: null,
            },
          ],
        ],
        []
      )
    );

    expect(listNotedPendingVtuReferences()).toEqual(['REF-SIBLING']);
    expect(hasNotedPendingVtuReference(scoped, 'REF-SIBLING')).toBe(true);
  });
});
