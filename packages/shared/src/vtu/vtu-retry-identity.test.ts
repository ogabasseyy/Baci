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
      'billerName',
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
      billerName: null,
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

  it('drops non-identity fields (ephemeral refs, receipt metadata, bindings)', () => {
    const canonical = canonicalizeVtuRetryIdentity({
      amount: 500,
      validationReference: 'VAL-1',
      customerAddress: '1 Test St',
      customerName: 'Test',
      customerPhone: '0801',
      merchantSlug: 'ogabassey',
      expectedUserId: 'user-1',
    });

    expect(canonical).not.toHaveProperty('validationReference');
    expect(canonical).not.toHaveProperty('customerAddress');
    expect(canonical).not.toHaveProperty('customerName');
    expect(canonical).not.toHaveProperty('customerPhone');
    expect(canonical).not.toHaveProperty('merchantSlug');
    expect(canonical).not.toHaveProperty('expectedUserId');
  });
});
