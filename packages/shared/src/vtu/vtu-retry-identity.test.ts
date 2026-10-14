import { describe, expect, it } from 'vitest';
import {
  canonicalizeVtuRetryIdentity,
  VTU_RETRY_IDENTITY_FIELDS,
} from './vtu-retry-identity';

describe('vtu-retry-identity', () => {
  it('pins the exact canonical field list (server + both clients derive from it)', () => {
    // Any add/remove here MUST be a deliberate cross-side decision:
    // the server 409 guard and both client dedupe paths assume this
    // exact set. See the module doc for the lockstep rationale.
    expect([...VTU_RETRY_IDENTITY_FIELDS]).toEqual([
      'amount',
      'billItemIdentifier',
      'billerCode',
      'customerIdentifier',
      'dataPlanCode',
      'networkProvider',
      'phoneNumber',
      'productCode',
      'provider',
      'requireValidationRef',
      'type',
      'walletAmount',
    ]);
  });

  it('projects fixed-order fields with absent values normalized to null', () => {
    expect(
      canonicalizeVtuRetryIdentity({
        walletAmount: 500,
        type: 'airtime',
        amount: 500,
        phoneNumber: '0801',
      })
    ).toEqual({
      amount: 500,
      billItemIdentifier: null,
      billerCode: null,
      customerIdentifier: null,
      dataPlanCode: null,
      networkProvider: null,
      phoneNumber: '0801',
      productCode: null,
      provider: null,
      requireValidationRef: null,
      type: 'airtime',
      walletAmount: 500,
    });
  });

  it('converges cosmetic phone variants to one identity', () => {
    // A reformat between attempts must NOT mint a fresh key: the
    // descriptor is the only dedupe across an ambiguous timeout.
    const variants = [
      '08031234567',
      '+234 803 123 4567',
      '2348031234567',
      '8031234567',
      ' 08031234567 ',
    ];
    const canonical = variants.map((phoneNumber) =>
      canonicalizeVtuRetryIdentity({
        amount: 500,
        phoneNumber,
        type: 'airtime',
      })
    );
    for (const entry of canonical) {
      expect(entry.phoneNumber).toBe('08031234567');
    }
    expect(canonical[0]).toEqual(canonical[4]);
  });

  it('converges provider case, whitespace, and legacy aliases', () => {
    for (const networkProvider of ['MTN', 'mtn', ' Mtn ', 'MTN ']) {
      expect(
        canonicalizeVtuRetryIdentity({ networkProvider }).networkProvider
      ).toBe('MTN');
    }
    // Legacy Etisalat/T2 label (mirrors web normalization).
    for (const networkProvider of ['T2', 't2', ' t2 ']) {
      expect(
        canonicalizeVtuRetryIdentity({ networkProvider }).networkProvider
      ).toBe('9MOBILE');
    }
  });

  it('trims other string fields and passes non-strings through', () => {
    const canonical = canonicalizeVtuRetryIdentity({
      amount: 500,
      customerIdentifier: ' 123456 ',
      requireValidationRef: true,
      walletAmount: 0,
    });
    expect(canonical.customerIdentifier).toBe('123456');
    expect(canonical.requireValidationRef).toBe(true);
    expect(canonical.walletAmount).toBe(0);
    expect(canonical.phoneNumber).toBeNull();
  });

  it('drops non-identity fields (ephemeral refs, receipt metadata, bindings)', () => {
    const canonical = canonicalizeVtuRetryIdentity({
      amount: 500,
      billerName: 'Ikeja Electric',
      validationReference: 'VAL-1',
      customerAddress: '1 Test St',
      customerName: 'Test',
      customerPhone: '0801',
      merchantSlug: 'ogabassey',
      expectedUserId: 'user-1',
    });

    // Codex R90 P2: a catalog relabel between attempts must not
    // split the retry into a fresh key (double debit).
    expect(canonical).not.toHaveProperty('billerName');
    expect(
      canonicalizeVtuRetryIdentity({
        amount: 1000,
        billerCode: 'IKEDC',
        billerName: 'Ikeja Electric',
        customerIdentifier: '43901766923',
        productCode: 'IKEDC-PRE',
        type: 'electricity',
      })
    ).toEqual(
      canonicalizeVtuRetryIdentity({
        amount: 1000,
        billerCode: 'IKEDC',
        billerName: 'Ikeja Electric Distribution Co.',
        customerIdentifier: '43901766923',
        productCode: 'IKEDC-PRE',
        type: 'electricity',
      })
    );
    expect(canonical).not.toHaveProperty('validationReference');
    expect(canonical).not.toHaveProperty('customerAddress');
    expect(canonical).not.toHaveProperty('customerName');
    expect(canonical).not.toHaveProperty('customerPhone');
    expect(canonical).not.toHaveProperty('merchantSlug');
    expect(canonical).not.toHaveProperty('expectedUserId');
  });
});
