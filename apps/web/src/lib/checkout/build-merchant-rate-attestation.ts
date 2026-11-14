import { resolveSubdivisionCode } from '@/lib/shipping/merchant-rates/subdivisions';
import { MerchantRateAttestationInputError } from './merchant-rate-attestation-input-error';
import type { SharedCartRateBinding } from './shared-cart-rate-binding';
import type { StorefrontMerchantRateAttestation } from './storefront-order-claim-types';

function toMinorUnits(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new MerchantRateAttestationInputError(`${field} is invalid`);
  }
  const scaled = value * 100;
  const minor = Math.round(scaled);
  const tolerance = Math.min(
    1e-7 + Number.EPSILON * Math.abs(scaled) * 4,
    0.01
  );
  if (!Number.isSafeInteger(minor) || Math.abs(scaled - minor) > tolerance) {
    throw new MerchantRateAttestationInputError(
      `${field} must be representable as minor units`
    );
  }
  return minor;
}

/**
 * Converts server-verified route economics and trusted cart authority into the
 * signed RPC claim. The default-off flag is a rollout gate only; the database
 * must independently validate the claim before this path is protected.
 */
export function buildMerchantRateAttestation({
  enabled,
  sharedCart,
  shippingRateId,
  shippingConfigRevision,
  canonicalSubtotal,
  shippingFee,
  fulfillmentKind,
  addressCountry,
  addressState,
  merchantCountry,
  isReplay = false,
}: {
  enabled: boolean;
  sharedCart: SharedCartRateBinding | undefined;
  shippingRateId: string | null | undefined;
  shippingConfigRevision: string | undefined;
  canonicalSubtotal: number | null;
  shippingFee: number;
  fulfillmentKind: 'ship' | 'pickup';
  addressCountry: string | null | undefined;
  addressState: string | null | undefined;
  merchantCountry: string | null | undefined;
  isReplay?: boolean;
}): StorefrontMerchantRateAttestation | null {
  if (!enabled || !sharedCart || !shippingRateId || isReplay) return null;

  if (!shippingConfigRevision) {
    throw new MerchantRateAttestationInputError(
      'Shipping configuration revision is unavailable'
    );
  }
  if (canonicalSubtotal === null || !Number.isFinite(canonicalSubtotal)) {
    throw new MerchantRateAttestationInputError(
      'Canonical shipping basis is unavailable'
    );
  }

  const addressCountryCode = (addressCountry ?? '').trim();
  const fallbackCountryCode = (merchantCountry ?? '').trim();
  const destinationCountryCode = /^[A-Za-z]{2}$/.test(addressCountryCode)
    ? addressCountryCode.toUpperCase()
    : fallbackCountryCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(destinationCountryCode)) {
    throw new MerchantRateAttestationInputError(
      'Normalized shipping country is unavailable'
    );
  }

  return {
    shippingRateId,
    shippingConfigRevision,
    canonicalSubtotalMinor: toMinorUnits(
      canonicalSubtotal,
      'Canonical shipping basis'
    ),
    destinationCountryCode,
    destinationSubdivisionCode: resolveSubdivisionCode(
      destinationCountryCode,
      addressState ?? null
    ),
    shippingFeeMinor: toMinorUnits(shippingFee, 'Verified shipping fee'),
    fulfillmentKind,
  };
}
