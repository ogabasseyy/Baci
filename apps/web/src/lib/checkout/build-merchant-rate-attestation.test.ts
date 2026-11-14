import { describe, expect, it } from 'vitest';
import { buildMerchantRateAttestation } from './build-merchant-rate-attestation';

const validInput = {
  enabled: true,
  sharedCart: {
    cart_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    checkout_session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    checkout_generation: 2,
    cart_version: 7,
  },
  shippingRateId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  shippingConfigRevision: '42',
  canonicalSubtotal: 154.9,
  shippingFee: 12.5,
  fulfillmentKind: 'ship' as const,
  addressCountry: null,
  addressState: 'Lagos',
  merchantCountry: 'ng',
};

describe('buildMerchantRateAttestation', () => {
  it('keeps the feature default-off and preserves voucher/legacy input behavior', () => {
    expect(
      buildMerchantRateAttestation({
        ...validInput,
        enabled: false,
        shippingConfigRevision: undefined,
        canonicalSubtotal: null,
      })
    ).toBeNull();
    expect(
      buildMerchantRateAttestation({
        ...validInput,
        sharedCart: undefined,
      })
    ).toBeNull();
  });

  it('builds a normalized signed claim from trusted cart and verified rate values', () => {
    expect(buildMerchantRateAttestation(validInput)).toEqual({
      shippingRateId: validInput.shippingRateId,
      shippingConfigRevision: '42',
      canonicalSubtotalMinor: 15490,
      destinationCountryCode: 'NG',
      destinationSubdivisionCode: 'NG-LA',
      shippingFeeMinor: 1250,
      fulfillmentKind: 'ship',
    });
  });

  it.each([
    [5_000_000.55, 500_000_055],
    [10_000_000.55, 1_000_000_055],
  ])('preserves cents for large valid amounts (%s)', (amount, minorUnits) => {
    expect(
      buildMerchantRateAttestation({
        ...validInput,
        canonicalSubtotal: amount,
      })
    ).toMatchObject({ canonicalSubtotalMinor: minorUnits });
  });

  it('fails closed when the configuration revision is missing', () => {
    expect(() =>
      buildMerchantRateAttestation({
        ...validInput,
        shippingConfigRevision: undefined,
      })
    ).toThrow('Shipping configuration revision is unavailable');
  });

  it('fails closed when the fresh shipping basis is missing', () => {
    expect(() =>
      buildMerchantRateAttestation({ ...validInput, canonicalSubtotal: null })
    ).toThrow('Canonical shipping basis is unavailable');
  });

  it('fails closed when destination country cannot be normalized', () => {
    expect(() =>
      buildMerchantRateAttestation({ ...validInput, merchantCountry: null })
    ).toThrow('Normalized shipping country is unavailable');
  });

  it('rejects non-cent amounts instead of signing rounded caller-visible values', () => {
    expect(() =>
      buildMerchantRateAttestation({ ...validInput, canonicalSubtotal: 1.001 })
    ).toThrow('Canonical shipping basis must be representable as minor units');
  });

  it('rejects fractional cents at large magnitudes and unsafe minor-unit integers', () => {
    expect(() =>
      buildMerchantRateAttestation({
        ...validInput,
        canonicalSubtotal: 10_000_000.551,
      })
    ).toThrow('Canonical shipping basis must be representable as minor units');
    expect(() =>
      buildMerchantRateAttestation({
        ...validInput,
        canonicalSubtotal: Number.MAX_SAFE_INTEGER,
      })
    ).toThrow('Canonical shipping basis must be representable as minor units');
  });
});
