import {
  buildVtuPurchaseDescriptor,
  scopePendingVtuKey,
} from './pending-vtu-descriptor';
import {
  clearPendingVtuKeys,
  hasNotedPendingVtuReference,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from './pending-vtu-idempotency';
import * as vtuCodec from './pending-vtu-idempotency-codec';
import * as vtuStore from './pending-vtu-idempotency-store';
import { syncPendingVtuPurchasesFromSnapshot } from './pending-vtu-idempotency-sync';

function seedStore(
  entries: [string, { key: string; rememberedAt: number }][],
  forgotten: { scoped: string; forgottenAt: number; key?: string }[] = []
): void {
  vtuStore.savePendingVtuSnapshot(
    vtuCodec.serializePendingVtuEntries(
      entries.map(([scoped, entry]) => [
        scoped,
        {
          key: entry.key,
          reference: null,
          rememberedAt: entry.rememberedAt,
          completedAt: null,
        },
      ]),
      forgotten
    )
  );
}

function scopedDescriptor(tag: string): string {
  return scopePendingVtuKey(
    'user-a',
    'merchant-1',
    buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 1,
      phoneNumber: tag,
    })
  );
}

describe('pending-vtu-idempotency-sync', () => {
  beforeEach(() => {
    clearPendingVtuKeys();
  });

  it('imports a sibling-tab entry on direct sync (Codex R145 P1)', () => {
    const scoped = scopedDescriptor('direct-sync');
    seedStore([[scoped, { key: 'key-sib', rememberedAt: Date.now() }]]);

    syncPendingVtuPurchasesFromSnapshot();

    expect(recallPendingVtuKey(scoped)).toBe('key-sib');
  });

  it('live-deletes the matching generation on a key-bound tombstone (Codex R145 P1)', () => {
    const scoped = scopedDescriptor('live-delete');
    const now = Date.now();
    rememberPendingVtuPurchase(scoped, 'key-doomed');
    seedStore([], [{ scoped, forgottenAt: now + 1000, key: 'key-doomed' }]);

    syncPendingVtuPurchasesFromSnapshot(now + 2000);

    expect(recallPendingVtuKey(scoped)).toBeNull();
  });

  it('preserves a newer generation under an older generations tombstone (Codex R145 P1)', () => {
    // Web R61 parity: sibling forgot K1 after this tab minted K2 —
    // timestamp-only arbitration would erase the active K2 key.
    const scoped = scopedDescriptor('newer-gen');
    const now = Date.now();
    rememberPendingVtuPurchase(scoped, 'key-k2');
    seedStore(
      [[scoped, { key: 'key-k2', rememberedAt: now }]],
      [{ scoped, forgottenAt: now + 1000, key: 'key-k1' }]
    );

    syncPendingVtuPurchasesFromSnapshot(now + 2000);

    expect(recallPendingVtuKey(scoped)).toBe('key-k2');
  });

  it('falls back to timestamps for keyless legacy tombstones (Codex R145 P1)', () => {
    const scoped = scopedDescriptor('legacy-tomb');
    const now = Date.now();
    rememberPendingVtuPurchase(scoped, 'key-legacy');
    vtuStore.savePendingVtuSnapshot(
      vtuCodec.serializePendingVtuEntries(
        [],
        [{ scoped, forgottenAt: now + 1000 }]
      )
    );

    syncPendingVtuPurchasesFromSnapshot(now + 2000);

    expect(recallPendingVtuKey(scoped)).toBeNull();
  });

  it('merges sibling-tab reference knowledge into the live entry (Codex R145 P1)', () => {
    const scoped = scopedDescriptor('ref-merge');
    const now = Date.now();
    rememberPendingVtuPurchase(scoped, 'key-live');
    vtuStore.savePendingVtuSnapshot(
      vtuCodec.serializePendingVtuEntries(
        [
          [
            scoped,
            {
              key: 'key-live',
              reference: 'REF-DIRECT',
              rememberedAt: now,
              completedAt: null,
            },
          ],
        ],
        []
      )
    );

    syncPendingVtuPurchasesFromSnapshot(now + 1000);

    expect(hasNotedPendingVtuReference(scoped, 'REF-DIRECT')).toBe(true);
  });
});
