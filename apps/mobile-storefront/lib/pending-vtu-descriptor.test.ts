import {
  buildVtuPurchaseDescriptor,
  scopePendingVtuKey,
} from './pending-vtu-descriptor';

describe('pending-vtu-descriptor', () => {
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

  it('digests the scoped key so no identifier rests in the map', () => {
    const descriptor = buildVtuPurchaseDescriptor({
      type: 'airtime',
      amount: 7,
      phoneNumber: '08030000000',
    });
    const scoped = scopePendingVtuKey('customer-a', 'merchant-1', descriptor);

    expect(scoped).toMatch(/^[0-9a-f]{64}$/);
    expect(scoped).not.toContain('08030000000');
    expect(scoped).not.toContain('customer-a');
  });
});
