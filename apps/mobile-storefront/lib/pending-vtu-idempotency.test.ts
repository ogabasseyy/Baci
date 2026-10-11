import {
  buildVtuPurchaseDescriptor,
  clearPendingVtuKeys,
  forgetPendingVtuPurchase,
  isStalePendingVtuSuccess,
  notePendingVtuReference,
  PENDING_VTU_STALE_AFTER_MS,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
  scopePendingVtuKey,
  serializePendingVtuPurchases,
} from './pending-vtu-idempotency';
import { PERSISTED_VTU_KEY_TTL_MS } from './pending-vtu-idempotency-store';

describe('pending-vtu-idempotency', () => {
  it('describes identical payloads identically regardless of key order', () => {
    const a = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 500,
      phoneNumber: '0801',
    });
    const b = buildVtuPurchaseDescriptor({
      phoneNumber: '0801',
      amount: 500,
      type: 'airtime',
    });
    expect(a).toBe(b);
  });

  it('normalizes absent values and ignores non-fingerprint fields', () => {
    const a = buildVtuPurchaseDescriptor({ type: 'data', amount: 1000 });
    const b = buildVtuPurchaseDescriptor({
      type: 'data',
      amount: 1000,
      dataPlanCode: undefined,
      customerName: 'Ada',
      merchantSlug: 'ogabassey',
    });
    expect(a).toBe(b);
  });

  it('distinguishes payloads that differ in any fingerprint field', () => {
    const base = { type: 'airtime', amount: 500, phoneNumber: '0801' };
    expect(buildVtuPurchaseDescriptor({ ...base, amount: 1000 })).not.toBe(
      buildVtuPurchaseDescriptor(base)
    );
    expect(
      buildVtuPurchaseDescriptor({ ...base, phoneNumber: '0802' })
    ).not.toBe(buildVtuPurchaseDescriptor(base));
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

  it('flags a reference-less entry as stale only past the recall window', () => {
    // Within the window the first success IS the resolution (retry of
    // a lost response). Past it the submit is a NEW intent, and the
    // replay would present the prior transaction as the new purchase
    // without a new debit or vend.
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'data',
      amount: 3,
      phoneNumber: 'no-ref-yet',
    });
    const rememberedAt = Date.now();
    rememberPendingVtuPurchase(descriptor, 'key-noref');
    expect(isStalePendingVtuSuccess(descriptor, 'REF-FIRST')).toBe(false);
    expect(
      isStalePendingVtuSuccess(
        descriptor,
        'REF-FIRST',
        rememberedAt + PENDING_VTU_STALE_AFTER_MS + 1
      )
    ).toBe(true);
  });

  it('drops TTL-expired reference-less entries on recall', () => {
    // The TTL is the outer retention horizon; within-TTL old entries
    // are arbitrated by the stale check instead.
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 9,
      phoneNumber: 'ttl-drop',
    });
    rememberPendingVtuPurchase(descriptor, 'key-ttl');
    const expired = Date.now() + PERSISTED_VTU_KEY_TTL_MS + 1;
    expect(recallPendingVtuKey(descriptor, expired)).toBeNull();
    // Deletion sticks: a live recall also misses.
    expect(recallPendingVtuKey(descriptor)).toBeNull();
  });

  it('drops TTL-expired referenced entries on recall', () => {
    // No client-side signal proves terminality (noted references mark
    // non-terminal processing responses), so the 24h TTL applies
    // uniformly — including to referenced entries.
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 10,
      phoneNumber: 'ttl-ref',
    });
    rememberPendingVtuPurchase(descriptor, 'key-ttl-ref');
    notePendingVtuReference(descriptor, 'REF-TTL');
    const expired = Date.now() + PERSISTED_VTU_KEY_TTL_MS + 1;
    expect(recallPendingVtuKey(descriptor, expired)).toBeNull();
    // Deletion sticks: a live recall also misses.
    expect(recallPendingVtuKey(descriptor)).toBeNull();
  });

  it('evicts the oldest entry past the cap', () => {
    const descriptors = Array.from(
      { length: 40 },
      (_, index) =>
        `evict-${index}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    for (const descriptor of descriptors) {
      rememberPendingVtuPurchase(descriptor, `key-${descriptor}`);
    }
    expect(recallPendingVtuKey(descriptors[0])).toBeNull();
    expect(recallPendingVtuKey(descriptors[descriptors.length - 1])).toBe(
      `key-${descriptors[descriptors.length - 1]}`
    );
  });

  it('protects young referenced entries (even stale) from eviction', () => {
    // Staleness is deliberately NOT a victim criterion: a referenced
    // entry older than five minutes may still be processing, and the
    // stale branch needs its key. The oldest live entry goes instead.
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
      // Youngest-but-stale survivor kept (referenced ⇒ recallable iff present)…
      expect(recallPendingVtuKey('cap-31')).toBe('key-31');
      // …oldest live entry evicted instead.
      expect(recallPendingVtuKey('cap-0')).toBeNull();
      expect(recallPendingVtuKey('cap-new')).toBe('key-new');
    } finally {
      jest.useRealTimers();
    }
  });

  it('evicts past-TTL entries (even referenced) before live ones', () => {
    // sig-old is referenced but aged past the TTL (live recall would
    // drop it on access anyway); the rest are young. The past-TTL
    // entry goes first — otherwise the cap would wedge once 32
    // referenced entries accumulate.
    clearPendingVtuKeys();
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      rememberPendingVtuPurchase('sig-old', 'key-old');
      notePendingVtuReference('sig-old', 'REF-OLD');
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
      // Past-TTL referenced victim evicted…
      expect(recallPendingVtuKey('sig-old')).toBeNull();
      // …young survivors kept.
      expect(recallPendingVtuKey('live-0')).toBe('key-0');
      expect(recallPendingVtuKey('live-new')).toBe('key-new');
    } finally {
      jest.useRealTimers();
    }
  });

  it('binds the scoped key to owner and merchant', () => {
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 7,
      phoneNumber: 'scope-me',
    });
    const keyA = scopePendingVtuKey('customer-a', 'merchant-1', descriptor);

    // Same purchase, different owner or merchant: different entry.
    expect(scopePendingVtuKey('customer-b', 'merchant-1', descriptor)).not.toBe(
      keyA
    );
    expect(scopePendingVtuKey('customer-a', 'merchant-2', descriptor)).not.toBe(
      keyA
    );
    // Same triple: stable.
    expect(scopePendingVtuKey('customer-a', 'merchant-1', descriptor)).toBe(
      keyA
    );
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
});
