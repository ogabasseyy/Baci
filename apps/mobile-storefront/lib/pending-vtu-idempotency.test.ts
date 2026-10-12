import {
  buildVtuPurchaseDescriptor,
  clearPendingVtuKeys,
  forgetPendingVtuByReference,
  forgetPendingVtuPurchase,
  hasNotedPendingVtuReference,
  hydratePendingVtuPurchases,
  isStalePendingVtuSuccess,
  markPendingVtuCompleted,
  notePendingVtuReference,
  PENDING_VTU_STALE_AFTER_MS,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
  scopePendingVtuKey,
  serializePendingVtuPurchases,
} from './pending-vtu-idempotency';
import {
  noteForgottenVtuScopes,
  PERSISTED_VTU_KEY_TTL_MS,
  parsePendingVtuSnapshot,
} from './pending-vtu-idempotency-store';

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

  it('ignores validationReference: re-verification must not split retries', () => {
    // The provider can issue a new reference when the same meter is
    // re-verified after a timeout/202. Including it would miss recall,
    // mint fresh, and debit a second transaction while the first is
    // still unresolved.
    const a = buildVtuPurchaseDescriptor({
      type: 'electricity',
      amount: 1000,
      customerIdentifier: '43901766923',
      validationReference: 'VAL-123',
    });
    const b = buildVtuPurchaseDescriptor({
      type: 'electricity',
      amount: 1000,
      customerIdentifier: '43901766923',
      validationReference: 'VAL-456',
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

  it('builds one descriptor for cosmetic phone/provider variants', () => {
    // Same logical purchase after a reformat must reuse the key —
    // a second descriptor would debit and vend twice.
    const base = {
      type: 'airtime',
      amount: 500,
      phoneNumber: '08031234567',
      networkProvider: 'MTN',
    };
    const expected = buildVtuPurchaseDescriptor(base);
    for (const phoneNumber of [
      '+234 803 123 4567',
      '2348031234567',
      ' 08031234567 ',
    ]) {
      expect(buildVtuPurchaseDescriptor({ ...base, phoneNumber })).toBe(
        expected
      );
    }
    for (const networkProvider of ['mtn', ' MTN ', 'T2']) {
      expect(buildVtuPurchaseDescriptor({ ...base, networkProvider })).toBe(
        networkProvider === 'T2'
          ? buildVtuPurchaseDescriptor({
              ...base,
              networkProvider: '9MOBILE',
            })
          : expected
      );
    }
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

  it('drops TTL-expired reference-less entries on recall', () => {
    // Reference-less entries are never stale by policy (a re-tap
    // after failure is a retry), so the TTL is their only horizon.
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
    // non-terminal processing responses), so the 7-day TTL applies
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

    // The forget's own persist cleared its tombstone (MMKV is
    // memory-only under jest, so the write trivially succeeds);
    // re-note to prove the registry→snapshot plumbing directly.
    noteForgottenVtuScopes([scoped], Date.now());
    const snapshot = parsePendingVtuSnapshot(serializePendingVtuPurchases());

    expect(snapshot.entries).toEqual([]);
    expect(snapshot.forgotten).toHaveLength(1);
    expect(recallPendingVtuKey(scoped)).toBeNull();
  });
});
