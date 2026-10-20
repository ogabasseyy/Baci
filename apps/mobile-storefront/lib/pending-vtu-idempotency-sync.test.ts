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
  forgetPendingVtuPurchase,
  forgetPendingVtuPurchaseDurable,
  getPendingVtuKey,
  hasNotedPendingVtuReference,
  notePendingVtuReference,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from './pending-vtu-idempotency';
import * as vtuCodec from './pending-vtu-idempotency-codec';
import * as vtuStore from './pending-vtu-idempotency-store';
import {
  flushPendingVtuPurchases,
  runPendingVtuMintLocked,
  syncPendingVtuPurchasesFromSnapshot,
} from './pending-vtu-idempotency-sync';

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
    vtuStore.clearPendingVtuMintLock();
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

  it('serializes mint acquisition: a second contender waits out the budget (Codex R148 P1)', async () => {
    const first = await vtuStore.acquirePendingVtuMintLock();
    expect(typeof first).toBe('string');
    if (!first) {
      throw new Error('first acquire must succeed on an empty lock');
    }
    // Sibling tab spins the ~250ms budget, then fails closed (null).
    expect(await vtuStore.acquirePendingVtuMintLock()).toBeNull();
    vtuStore.releasePendingVtuMintLock(first);
    const second = await vtuStore.acquirePendingVtuMintLock();
    if (!second) {
      throw new Error('acquire must succeed after release');
    }
    expect(second).not.toBe(first);
    vtuStore.releasePendingVtuMintLock(second);
  }, 10000);

  it('steals an expired lock immediately (Codex R148 P1)', async () => {
    vtuStore.savePendingVtuMintLock(
      'crashed-holder',
      Date.now() - vtuStore.PENDING_VTU_MINT_LOCK_TTL_MS - 50
    );
    const token = await vtuStore.acquirePendingVtuMintLock();
    if (!token) {
      throw new Error('expired lock must be stealable');
    }
    vtuStore.releasePendingVtuMintLock(token);
  });

  it('releases only the holding token (Codex R148 P1)', async () => {
    const token = await vtuStore.acquirePendingVtuMintLock();
    if (!token) {
      throw new Error('acquire must succeed on an empty lock');
    }
    vtuStore.releasePendingVtuMintLock('someone-else');
    expect(vtuStore.loadPendingVtuMintLock()?.token).toBe(token);
    vtuStore.releasePendingVtuMintLock(token);
    expect(vtuStore.loadPendingVtuMintLock()).toBeNull();
  });

  it('runs the mint under navigator.locks when available (Muse R149 M1, web mirror)', async () => {
    // Immediate-grant mock: proves the primary path delegates to a
    // real mutex (bypassing the runner leaves request uncalled).
    const request = jest.fn(async (_name: string, callback: () => string) =>
      callback()
    );
    const priorNavigator = (globalThis as { navigator?: unknown }).navigator;
    (globalThis as { navigator?: unknown }).navigator = { locks: { request } };
    try {
      const key = await getPendingVtuKey('{"locks":"primary"}');
      expect(typeof key).toBe('string');
      // No exact count (R152 P1, web mirror): remember() schedules
      // a coalesced background flush that re-locks — the name pin
      // below is the wiring proof.
      expect(request).toHaveBeenCalled();
      expect(request).toHaveBeenCalledWith(
        vtuStore.PENDING_VTU_MINT_LOCK_NAME,
        expect.any(Function)
      );
      // Callback throws reject (never a sync throw, never a retry).
      await expect(
        runPendingVtuMintLocked(() => {
          throw new Error('undurable');
        })
      ).rejects.toThrow('undurable');
    } finally {
      (globalThis as { navigator?: unknown }).navigator = priorNavigator;
    }
  });

  it('serializes simultaneous mints so both tabs share one key (Muse R149 M1, web mirror)', async () => {
    // Queuing mock with genuine lock semantics: the second
    // request's callback cannot start until the first resolves.
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
    const request = jest.fn((_name: string, callback: () => string) =>
      new Promise<string>((resolve) => {
        queue.push(() => resolve(callback()));
        pump();
      }).finally(() => {
        running = false;
        pump();
      })
    );
    const priorNavigator = (globalThis as { navigator?: unknown }).navigator;
    (globalThis as { navigator?: unknown }).navigator = { locks: { request } };
    try {
      const [tabA, tabB] = await Promise.all([
        getPendingVtuKey('{"locks":"race"}'),
        getPendingVtuKey('{"locks":"race"}'),
      ]);
      expect(tabA).toBe(tabB);
      // No exact count (R152 P1, web mirror): each mint's scheduled
      // background flush re-locks on its own microtask.
      expect(request).toHaveBeenCalled();
    } finally {
      (globalThis as { navigator?: unknown }).navigator = priorNavigator;
    }
  });

  it('falls back to the storage lock without navigator.locks (Muse R149 M1, web mirror)', async () => {
    // Force the fallback path deterministically: the RN jest env
    // ships its own navigator shape, so pin one without locks.
    const g = globalThis as { navigator?: unknown };
    const priorNavigator = g.navigator;
    g.navigator = {};
    try {
      // Fallback held → null (caller throws); released → runs fn.
      vtuStore.savePendingVtuMintLock('tab-a', Date.now());
      await expect(runPendingVtuMintLocked(() => 'k')).resolves.toBeNull();
      vtuStore.clearPendingVtuMintLock();
      await expect(runPendingVtuMintLocked(() => 'k')).resolves.toBe('k');
      // Fallback callback throws propagate (never retried unlocked).
      await expect(
        runPendingVtuMintLocked(() => {
          throw new Error('undurable');
        })
      ).rejects.toThrow('undurable');
      expect(vtuStore.loadPendingVtuMintLock()).toBeNull();
    } finally {
      g.navigator = priorNavigator;
    }
  }, 10000);

  it('fails closed without navigator.locks in a multi-tab browser (Codex R152 P1, web mirror)', async () => {
    // This jest env has window but no document (native-shaped), so
    // the fallback applies by default. Pinning document makes it
    // browser-shaped: minting must then refuse rather than risk a
    // sibling-tab double mint through the non-atomic fallback.
    const g = globalThis as { navigator?: unknown; document?: unknown };
    const priorNavigator = g.navigator;
    const priorDocument = g.document;
    g.navigator = {};
    g.document = {};
    try {
      await expect(runPendingVtuMintLocked(() => 'k')).rejects.toThrow(
        /update your browser/
      );
      await expect(getPendingVtuKey('{"locks":"missing"}')).rejects.toThrow(
        /update your browser/
      );
    } finally {
      g.navigator = priorNavigator;
      if (priorDocument === undefined) {
        delete g.document;
      } else {
        g.document = priorDocument;
      }
    }
  });

  it('yields the event loop while waiting on a held mint (Muse R151 M1, web mirror)', async () => {
    // A busy-spin would block the JS thread for the full ~250ms
    // budget: the 10ms timer could only fire after acquisition
    // settles. Timer-polled waits yield, so the timer wins.
    vtuStore.savePendingVtuMintLock('tab-a', Date.now());
    const order: string[] = [];
    setTimeout(() => {
      order.push('timer');
    }, 10);
    await expect(vtuStore.acquirePendingVtuMintLock()).resolves.toBeNull();
    order.push('acquired');
    expect(order).toEqual(['timer', 'acquired']);
    vtuStore.clearPendingVtuMintLock();
  }, 10000);

  it('retries a background flush dropped to contention (Codex R153 P2, web mirror)', async () => {
    // Pin the fallback: the RN jest env ships its own navigator
    // shape, and the locks path never reports contention.
    const g = globalThis as { navigator?: unknown };
    const priorNavigator = g.navigator;
    g.navigator = {};
    try {
      const descriptor = scopedDescriptor('cret');
      await getPendingVtuKey(descriptor);
      await flushPendingVtuPurchases();
      // Sibling holds the lock: the chain's first microtask attempt
      // deterministically fails; the macrotask release lands before
      // the second attempt, proving the retry (pre-fix the single
      // attempt dropped it here and no new mutation would reland it).
      vtuStore.savePendingVtuMintLock('tab-other', Date.now());
      notePendingVtuReference(descriptor, 'REF-CRET');
      setTimeout(() => vtuStore.clearPendingVtuMintLock(), 0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const snapshot = vtuCodec.parsePendingVtuSnapshot(
        vtuStore.loadPendingVtuSnapshot()
      );
      expect(snapshot.entries).toHaveLength(1);
      expect(snapshot.entries[0][1].reference).toBe('REF-CRET');
    } finally {
      g.navigator = priorNavigator;
      vtuStore.clearPendingVtuMintLock();
    }
  });

  it('lands terminal deletions before returning (Codex R153 P2, web mirror)', async () => {
    const scheduled = scopedDescriptor('sched');
    const durable = scopedDescriptor('dur');
    await getPendingVtuKey(scheduled);
    await getPendingVtuKey(durable);
    await flushPendingVtuPurchases();

    // Scheduled forget is NOT durable on return (the P2 window).
    forgetPendingVtuPurchase(scheduled);
    expect(
      vtuCodec
        .parsePendingVtuSnapshot(vtuStore.loadPendingVtuSnapshot())
        .entries.map(([scoped]) => scoped)
    ).toContain(scheduled);

    // Durable forget is: memory drops AND the locked flush lands
    // before the result finalizes.
    await expect(forgetPendingVtuPurchaseDurable(durable)).resolves.toBe(true);
    const snapshot = vtuCodec.parsePendingVtuSnapshot(
      vtuStore.loadPendingVtuSnapshot()
    );
    expect(snapshot.entries.map(([scoped]) => scoped)).not.toContain(durable);
    expect(snapshot.forgotten.map((tombstone) => tombstone.scoped)).toContain(
      durable
    );
    expect(recallPendingVtuKey(durable)).toBeNull();
  });

  it('absorbs transient write blips inside the durable forget (Codex R155 P2, web mirror)', async () => {
    const descriptor = scopedDescriptor('blip');
    await getPendingVtuKey(descriptor);
    await flushPendingVtuPurchases();
    // Drain the scheduled chain: only the durable attempts below may
    // consume the one-shot persist failures.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const persistSpy = jest
      .spyOn(vtuStore, 'persistPendingVtuEntries')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);
    try {
      // Two attempts fail, the third lands: true, no scheduled retry.
      await expect(forgetPendingVtuPurchaseDurable(descriptor)).resolves.toBe(
        true
      );
    } finally {
      persistSpy.mockRestore();
    }

    const snapshot = vtuCodec.parsePendingVtuSnapshot(
      vtuStore.loadPendingVtuSnapshot()
    );
    expect(snapshot.entries).toHaveLength(0);
    expect(snapshot.forgotten.map((tombstone) => tombstone.scoped)).toContain(
      descriptor
    );
  });

  it('reports persistent storage failure instead of claiming durability (Codex R155 P2, web mirror)', async () => {
    const descriptor = scopedDescriptor('broken');
    await getPendingVtuKey(descriptor);
    await flushPendingVtuPurchases();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const persistSpy = jest
      .spyOn(vtuStore, 'persistPendingVtuEntries')
      .mockReturnValue(false);
    try {
      // All attempts fail: false (never a false true), memory still
      // drops so this tab stays exact, and the failure is logged.
      await expect(forgetPendingVtuPurchaseDurable(descriptor)).resolves.toBe(
        false
      );
      expect(consoleError).toHaveBeenCalledWith(
        'VTU registry terminal forget not durable; retry scheduled.'
      );
      expect(recallPendingVtuKey(descriptor)).toBeNull();
    } finally {
      consoleError.mockRestore();
      persistSpy.mockRestore();
    }
  });
});
