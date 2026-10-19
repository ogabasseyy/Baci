import { describe, expect, it } from 'vitest';
import { buildVtuWalletPayloadSignature } from './utility-vtu-payload-signature';

describe('utility-vtu-payload-signature', () => {
  it('signs identical intents identically regardless of key order', () => {
    const a = buildVtuWalletPayloadSignature({
      type: 'airtime',
      amount: 500,
      phoneNumber: '0801',
      walletAmount: 500,
    });
    const b = buildVtuWalletPayloadSignature({
      walletAmount: 500,
      phoneNumber: '0801',
      amount: 500,
      type: 'airtime',
    });

    expect(a).toBe(b);
  });

  it('ignores cosmetic fields so hydration races still replay', () => {
    const base = {
      amount: 500,
      type: 'airtime',
      phoneNumber: '0801',
      walletAmount: 500,
    };
    // customerName normalizes + phone arrives between a timed-out submit
    // and the retry: the retry MUST reuse the pending key.
    const before = buildVtuWalletPayloadSignature({
      ...base,
      customerName: 'Customer',
      merchantSlug: 'ogabassey',
    });
    const after = buildVtuWalletPayloadSignature({
      ...base,
      customerName: 'Test Customer',
      customerPhone: '0801',
      customerAddress: '1 Test St',
      merchantSlug: 'ogabassey',
    });

    expect(after).toBe(before);
  });

  it('ignores validationReference: re-verification must not split retries', () => {
    // The provider can issue a new reference when the same meter is
    // re-verified after a timeout/202. Including it would miss recall,
    // mint fresh, and debit a second transaction while the first is
    // still unresolved.
    const base = {
      amount: 1000,
      type: 'electricity',
      customerIdentifier: '43901766923',
      walletAmount: 1000,
    };
    const before = buildVtuWalletPayloadSignature({
      ...base,
      validationReference: 'VAL-123',
    });
    const after = buildVtuWalletPayloadSignature({
      ...base,
      validationReference: 'VAL-456',
    });

    expect(after).toBe(before);
  });

  it('distinguishes intents that differ in any fingerprint field', () => {
    const base = {
      amount: 500,
      type: 'airtime',
      phoneNumber: '0801',
      walletAmount: 500,
    };

    expect(
      buildVtuWalletPayloadSignature({ ...base, amount: 1000 })
    ).not.toBe(buildVtuWalletPayloadSignature(base));
    expect(
      buildVtuWalletPayloadSignature({ ...base, phoneNumber: '0802' })
    ).not.toBe(buildVtuWalletPayloadSignature(base));
  });
});
