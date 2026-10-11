import {
  buildVtuPurchaseDescriptor,
  forgetPendingVtuPurchase,
  isStalePendingVtuSuccess,
  notePendingVtuReference,
  PENDING_VTU_STALE_AFTER_MS,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
  scopePendingVtuKey,
} from './pending-vtu-idempotency';

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

  it('never flags a reference-less entry as stale', () => {
    // Network-error submits never got a response: their first success
    // IS the resolution, however late it arrives.
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
});
