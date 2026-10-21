import { adoptCanonicalVtuKey } from './pending-vtu-canonical-adoption';
import {
  forgetOwnPendingVtuPurchase,
  forgetOwnPendingVtuPurchaseDurable,
  isOwnPendingVtuStaleSuccess,
  markOwnPendingVtuCompleted,
  noteOwnPendingVtuReference,
} from './pending-vtu-generation-guards';
import {
  clearPendingVtuKeys,
  hasNotedPendingVtuReference,
  isStalePendingVtuSuccess,
  markPendingVtuCompleted,
  notePendingVtuReference,
  PENDING_VTU_STALE_AFTER_MS,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from './pending-vtu-idempotency';
import { parsePendingVtuSnapshot } from './pending-vtu-idempotency-codec';
import * as vtuStore from './pending-vtu-idempotency-store';
import * as vtuSync from './pending-vtu-idempotency-sync';
import { flushPendingVtuPurchases } from './pending-vtu-idempotency-sync';
import { noteForgottenVtuScopes } from './pending-vtu-tombstones';

describe('pending-vtu-generation-guards', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
    vtuStore.clearPendingVtuMintLock();
  });

  it('notes and completes only the expected generation', () => {
    rememberPendingVtuPurchase('d-own', 'key-mine');
    rememberPendingVtuPurchase('d-newer', 'key-newer');

    noteOwnPendingVtuReference('d-own', 'REF-1', 'key-mine');
    markOwnPendingVtuCompleted('d-own', 'key-mine');
    // Vetoed generation: neither the reference nor completion lands.
    noteOwnPendingVtuReference('d-newer', 'REF-STALE', 'key-loser');
    markOwnPendingVtuCompleted('d-newer', 'key-loser');

    expect(hasNotedPendingVtuReference('d-own', 'REF-1')).toBe(true);
    expect(hasNotedPendingVtuReference('d-newer', 'REF-STALE')).toBe(false);
    expect(recallPendingVtuKey('d-newer')).toBe('key-newer');
    // Completed own entry is stale past the window; the vetoed
    // entry never completed.
    const doneAt = Date.now();
    markPendingVtuCompleted('d-own', doneAt);
    expect(
      isStalePendingVtuSuccess(
        'd-own',
        'REF-1',
        doneAt + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
  });

  it('reports stale only for the expected generation', () => {
    const doneAt = Date.now();
    rememberPendingVtuPurchase('d-stale', 'key-old');
    notePendingVtuReference('d-stale', 'REF-OLD');
    markPendingVtuCompleted('d-stale', doneAt);
    const late = doneAt + PENDING_VTU_STALE_AFTER_MS + 1;

    expect(
      isOwnPendingVtuStaleSuccess('d-stale', 'REF-OLD', 'key-old', late)
    ).toBe(true);
    // Same entry, wrong generation expectation: not stale (routes
    // the vetoed response to present instead of already-completed).
    expect(
      isOwnPendingVtuStaleSuccess('d-stale', 'REF-OLD', 'key-loser', late)
    ).toBe(false);
    expect(
      isOwnPendingVtuStaleSuccess('d-missing', 'REF-OLD', 'key-loser', late)
    ).toBe(false);
  });

  it('sync-forgets only the expected generation', () => {
    rememberPendingVtuPurchase('d-mine', 'key-mine');
    rememberPendingVtuPurchase('d-newer', 'key-newer');

    forgetOwnPendingVtuPurchase('d-mine', 'key-mine');
    forgetOwnPendingVtuPurchase('d-newer', 'key-loser');
    forgetOwnPendingVtuPurchase('d-missing', 'key-loser');

    expect(recallPendingVtuKey('d-mine')).toBeNull();
    expect(recallPendingVtuKey('d-newer')).toBe('key-newer');
  });

  it('durably forgets only the expected generation', async () => {
    rememberPendingVtuPurchase('d-mine', 'key-mine');
    rememberPendingVtuPurchase('d-newer', 'key-newer');

    await expect(
      forgetOwnPendingVtuPurchaseDurable('d-mine', 'key-mine')
    ).resolves.toBe(true);
    await expect(
      forgetOwnPendingVtuPurchaseDurable('d-newer', 'key-loser')
    ).resolves.toBe(false);

    expect(recallPendingVtuKey('d-mine')).toBeNull();
    expect(recallPendingVtuKey('d-newer')).toBe('key-newer');
  });

  it('a generation minted during the durable-forget flush survives', async () => {
    // Jules #3730 High refutation (lock-in): the ownership check
    // and the memory delete run synchronously with no yield
    // between them, and the tombstone is key-bound — so a new
    // generation minted after the check but before the flush
    // completes is never deleted by the in-flight forget (the
    // key-bound live-delete/merge in syncFromSnapshot lets K2
    // survive K1's tombstone, same-tab and cross-tab).
    rememberPendingVtuPurchase('d-race', 'key-k1');
    await flushPendingVtuPurchases();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Start the K1 forget: the sync check-then-delete prefix runs
    // now; the locked flush completes after our mint below.
    const forgotten = forgetOwnPendingVtuPurchaseDurable('d-race', 'key-k1');
    // A sibling flow mints K2 while the K1 flush is in flight.
    rememberPendingVtuPurchase('d-race', 'key-k2');
    await expect(forgotten).resolves.toBe(true);

    expect(recallPendingVtuKey('d-race')).toBe('key-k2');
    const snapshot = parsePendingVtuSnapshot(vtuStore.loadPendingVtuSnapshot());
    expect(snapshot.entries).toEqual([
      ['d-race', expect.objectContaining({ key: 'key-k2' })],
    ]);
  });

  it('settling the winner cannot resurrect a tombstoned persisted loser', async () => {
    // Codex P2 (mobile half): after a non-durable adoption, memory
    // holds the winner while storage still holds the loser. The
    // checkout tombstones the loser explicitly; terminal settlement
    // of the winner must then leave the loser suppressed instead
    // of resurrecting it on merge (key-bound tombstones ignore a
    // winner-only tombstone for a loser-keyed entry).
    rememberPendingVtuPurchase('d-settle', 'key-loser');
    await flushPendingVtuPurchases();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Force the adoption flush to fail: memory rebinds, storage
    // keeps the loser, adoption reports non-durable. The scheduled
    // retry is held back so this test pins the tombstone structure
    // itself, not whichever flush wins the race.
    const scheduleSpy = jest
      .spyOn(vtuSync, 'schedulePendingVtuFlush')
      .mockImplementation(() => {});
    const persistSpy = jest
      .spyOn(vtuStore, 'persistPendingVtuEntries')
      .mockReturnValue(false);
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      await expect(
        adoptCanonicalVtuKey('d-settle', 'key-loser', 'key-winner')
      ).resolves.toBe(false);
    } finally {
      persistSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      scheduleSpy.mockRestore();
    }
    expect(recallPendingVtuKey('d-settle')).toBe('key-winner');
    // What chargeWalletForVtu now does on a non-durable adoption.
    noteForgottenVtuScopes(['d-settle'], Date.now(), 'key-loser');
    // Cross-ms gap: single-slot replacement would drop the loser
    // record here — multi-key tombstones must keep both.
    await new Promise((resolve) => setTimeout(resolve, 3));
    // Terminal settlement of the winner generation.
    await expect(
      forgetOwnPendingVtuPurchaseDurable('d-settle', 'key-winner')
    ).resolves.toBe(true);

    expect(recallPendingVtuKey('d-settle')).toBeNull();
    const snapshot = parsePendingVtuSnapshot(vtuStore.loadPendingVtuSnapshot());
    expect(snapshot.entries).toEqual([]);
  });
});
