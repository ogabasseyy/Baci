import {
  buildVtuPurchaseDescriptor,
  forgetPendingVtuPurchase,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
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
});
