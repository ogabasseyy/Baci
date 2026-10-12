import { describe, expect, it } from 'vitest';
import type { VtuWalletOnlyChargeInput } from '@/schemas/vtu-wallet-only';
import { computeVtuWalletRequestFingerprint } from './vtu-wallet-fingerprint';

const BASE_AIRTIME: VtuWalletOnlyChargeInput = {
  source: 'checkout',
  merchantSlug: 'ogabassey',
  type: 'airtime',
  amount: 1000,
  walletAmount: 1000,
  phoneNumber: '08012345678',
  networkProvider: 'MTN',
} as VtuWalletOnlyChargeInput;

describe('computeVtuWalletRequestFingerprint', () => {
  it('returns the same hex string for two requests with identical recipient/intent fields', () => {
    expect(computeVtuWalletRequestFingerprint(BASE_AIRTIME)).toBe(
      computeVtuWalletRequestFingerprint(BASE_AIRTIME)
    );
  });

  it('produces a different hash when the amount changes', () => {
    const a = computeVtuWalletRequestFingerprint(BASE_AIRTIME);
    const b = computeVtuWalletRequestFingerprint({
      ...BASE_AIRTIME,
      amount: 2000,
      walletAmount: 2000,
    });
    expect(a).not.toBe(b);
  });

  it('produces a different hash when the recipient phone changes', () => {
    const a = computeVtuWalletRequestFingerprint(BASE_AIRTIME);
    const b = computeVtuWalletRequestFingerprint({
      ...BASE_AIRTIME,
      phoneNumber: '08099999999',
    });
    expect(a).not.toBe(b);
  });

  it('hashes cosmetic phone/provider variants identically', () => {
    // A reformat between attempts must attach to the same identity —
    // otherwise the retry mints a fresh key and debits twice.
    const a = computeVtuWalletRequestFingerprint(BASE_AIRTIME);
    for (const phoneNumber of [
      '+234 801 234 5678',
      '2348012345678',
      ' 08012345678 ',
    ]) {
      expect(
        computeVtuWalletRequestFingerprint({ ...BASE_AIRTIME, phoneNumber })
      ).toBe(a);
    }
    for (const networkProvider of ['mtn', ' MTN ', 'Mtn']) {
      expect(
        computeVtuWalletRequestFingerprint({
          ...BASE_AIRTIME,
          networkProvider,
        })
      ).toBe(a);
    }
  });

  it('produces a different hash when the type changes', () => {
    const a = computeVtuWalletRequestFingerprint(BASE_AIRTIME);
    const b = computeVtuWalletRequestFingerprint({
      ...BASE_AIRTIME,
      type: 'data',
      dataPlanCode: 'mtn-1gb-30d',
    } as VtuWalletOnlyChargeInput);
    expect(a).not.toBe(b);
  });

  it('produces a different hash when Monnify provider routing fields change', () => {
    const kuda = computeVtuWalletRequestFingerprint(BASE_AIRTIME);
    const monnify = computeVtuWalletRequestFingerprint({
      ...BASE_AIRTIME,
      billerCode: 'MTN',
      productCode: '13',
      provider: 'monnify',
    });

    expect(kuda).not.toBe(monnify);
    expect(monnify).not.toBe(
      computeVtuWalletRequestFingerprint({
        ...BASE_AIRTIME,
        billerCode: 'GLO',
        productCode: '12',
        provider: 'monnify',
      })
    );
  });

  it('ignores the ephemeral validationReference (re-verification must not split retries)', () => {
    // validationReference is a per-verification artifact: re-verifying
    // the same meter can issue a new one. Hashing it would miss recall
    // on retry, mint a fresh key, and debit a second transaction while
    // the first remains unresolved. requireValidationRef still
    // participates (it changes the purchase requirements).
    const firstVerification = computeVtuWalletRequestFingerprint({
      ...BASE_AIRTIME,
      billerCode: 'IKEDC',
      productCode: 'IKEDC_PREPAID',
      provider: 'monnify',
      requireValidationRef: true,
      validationReference: 'VAL-123',
    });

    expect(
      computeVtuWalletRequestFingerprint({
        ...BASE_AIRTIME,
        billerCode: 'IKEDC',
        productCode: 'IKEDC_PREPAID',
        provider: 'monnify',
        requireValidationRef: true,
        validationReference: 'VAL-456',
      })
    ).toBe(firstVerification);

    expect(
      computeVtuWalletRequestFingerprint({
        ...BASE_AIRTIME,
        billerCode: 'IKEDC',
        productCode: 'IKEDC_PREPAID',
        provider: 'monnify',
      })
    ).not.toBe(firstVerification);
  });

  it('ignores customerAddress (receipt-only; re-verified address must not split retries)', () => {
    // customerAddress lands only in metadata.address for receipts — never a
    // vend input. Hashing it would turn a re-verified address into a fresh
    // key and a second debit. Accepted residual: replay keeps the earlier
    // receipt address.
    const first = computeVtuWalletRequestFingerprint({
      ...BASE_AIRTIME,
      customerAddress: '12 Old Street, Lagos',
    });

    expect(
      computeVtuWalletRequestFingerprint({
        ...BASE_AIRTIME,
        customerAddress: '34 New Avenue, Lagos',
      })
    ).toBe(first);
  });

  it('produces the same hash regardless of object key insertion order', () => {
    // Pin determinism: the canonical replacer-array stringification
    // means inserting fields in a different order MUST yield the
    // identical hash. Without this guarantee a "different" runtime
    // serialization order could falsely 409 a legitimate retry.
    const reorderedFields: VtuWalletOnlyChargeInput = {
      networkProvider: 'MTN',
      phoneNumber: '08012345678',
      amount: 1000,
      walletAmount: 1000,
      type: 'airtime',
      merchantSlug: 'ogabassey',
      source: 'checkout',
    } as VtuWalletOnlyChargeInput;
    expect(computeVtuWalletRequestFingerprint(reorderedFields)).toBe(
      computeVtuWalletRequestFingerprint(BASE_AIRTIME)
    );
  });

  it('ignores cosmetic fields not in the canonical set (e.g. customerName, customerPhone, merchantSlug)', () => {
    // customerName / customerPhone are cosmetic — they don't change
    // the recipient of the vend, and excluding them prevents
    // false-positive 409s when a name normalizer changes between
    // attempts. merchantSlug is also out (auth covers it).
    const withCosmetics = {
      ...BASE_AIRTIME,
      customerName: 'JANE DOE',
      customerPhone: '08000000000',
      merchantSlug: 'a-different-slug',
    } as VtuWalletOnlyChargeInput;
    expect(computeVtuWalletRequestFingerprint(withCosmetics)).toBe(
      computeVtuWalletRequestFingerprint(BASE_AIRTIME)
    );
  });

  it('produces a 64-character hex SHA-256 digest', () => {
    const hash = computeVtuWalletRequestFingerprint(BASE_AIRTIME);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
