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
import * as vtuStore from './pending-vtu-idempotency-store';

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
});
