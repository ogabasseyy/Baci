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
import {
  loadPendingVtuSnapshot,
  parsePendingVtuSnapshot,
  savePendingVtuSnapshot,
} from './utility-pending-idempotency-store';
import {
  hydratePendingVtuPurchases,
  pendingVtuPurchases,
  serializePendingVtuPurchases,
} from './utility-pending-vtu-sync';

describe('utility-pending-vtu-sync', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
  });

  it('recalls the pending key after a page reload', async () => {
    const key = getPendingVtuKey('{"reload":true}');
    notePendingVtuReference('{"reload":true}', 'REF-RELOAD');

    // A reload re-executes the module with an empty map; the
    // localStorage entry must restore the pending purchase.
    vi.resetModules();
    const fresh = await import('./utility-pending-idempotency');

    expect(fresh.recallPendingVtuKey('{"reload":true}')).toBe(key);
    expect(
      fresh.hasNotedPendingVtuReference('{"reload":true}', 'REF-RELOAD')
    ).toBe(true);
  });

  it('recalls a key another tab persisted after this tab loaded', () => {
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

  it('drops a locally-held entry another tab deleted (tombstone sync)', () => {
    // Tab B holds SIG-DEL in memory while tab A completes it: A's
    // forget persists a snapshot WITHOUT the entry but WITH a
    // tombstone. B's next recall must drop its in-memory copy — if B
    // wrote it back, an identical purchase would replay the completed
    // transaction as a new success without a new debit.
    const key = getPendingVtuKey('SIG-DEL');
    expect(recallPendingVtuKey('SIG-DEL')).toBe(key);

    savePendingVtuSnapshot(
      JSON.stringify({
        entries: [],
        forgotten: [{ scoped: 'SIG-DEL', forgottenAt: Date.now() }],
      })
    );

    expect(recallPendingVtuKey('SIG-DEL')).toBeUndefined();
    // B's next persist carries the tombstone but not the entry.
    getPendingVtuKey('SIG-OTHER');
    const snapshot = parsePendingVtuSnapshot(loadPendingVtuSnapshot());
    expect(snapshot.entries.map(([scoped]) => scoped)).not.toContain(
      'SIG-DEL'
    );
    expect(snapshot.forgotten.map((t) => t.scoped)).toContain('SIG-DEL');
  });

  it('merges a re-remembered entry newer than its tombstone', () => {
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

  it('hydration never clobbers a live attempt with the snapshot', () => {
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

  it('hydration normalizes legacy rows without completion tracking', () => {
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

  it('forgetting persists a tombstone so other tabs drop the key', () => {
    rememberPendingVtuPurchase('SIG-A', 'key-a');
    forgetPendingVtuPurchase('SIG-A');

    const parsed = parsePendingVtuSnapshot(loadPendingVtuSnapshot());

    expect(parsed.entries).toHaveLength(0);
    expect(parsed.forgotten.map((t) => t.scoped)).toContain('SIG-A');
  });

  it('serialization round-trips live entries with their settlement', () => {
    rememberPendingVtuPurchase('SIG-A', 'key-a');
    notePendingVtuReference('SIG-A', 'REF-A');

    const parsed = parsePendingVtuSnapshot(serializePendingVtuPurchases());

    expect(parsed.entries.map(([scoped]) => scoped)).toContain('SIG-A');
    expect(pendingVtuPurchases.get('SIG-A')?.key).toBe('key-a');
  });

  it('merges another tab’s completion into the matching live entry', () => {
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

  it('merges a reference another tab noted after this tab imported', () => {
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

  it('keeps the earliest completion when both tabs observed it', () => {
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

  it('ignores persisted settlement when the live key is a newer generation', () => {
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
});
