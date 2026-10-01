import {
  TRANSACTION_DISCOUNT_METADATA_KEY,
  type TransactionDiscountLineAllocation,
} from '@baci/shared/contracts';

interface GeoPrivacyInput {
  country?: string;
  region?: string;
  shouldApplyLDU: boolean;
}

interface BuildTransactionDiscountAdTrackingInput {
  adTracking?: unknown;
  clientIp?: string;
  clientUserAgent?: string;
  geoPrivacy: GeoPrivacyInput;
  lineDiscounts?: Array<TransactionDiscountLineAllocation | null>;
  shouldApplyServerDerivedDiscount: boolean;
  transactionDiscountProof?: object;
  transactionDiscountNonce?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Keeps client attribution data while replacing the reserved discount marker
 * with the server-authored, line-aware allocation contract.
 */
export function buildTransactionDiscountAdTracking({
  adTracking,
  clientIp,
  clientUserAgent,
  geoPrivacy,
  lineDiscounts,
  shouldApplyServerDerivedDiscount,
  transactionDiscountNonce,
  transactionDiscountProof,
}: BuildTransactionDiscountAdTrackingInput): Record<string, unknown> | null {
  const source = isRecord(adTracking) ? adTracking : null;
  const sourceWithoutReservedMetadata = source
    ? Object.fromEntries(
        Object.entries(source).filter(
          ([key]) => key !== TRANSACTION_DISCOUNT_METADATA_KEY
        )
      )
    : null;
  const adTrackingBase = sourceWithoutReservedMetadata
    ? {
        ...sourceWithoutReservedMetadata,
        userIp: clientIp || source?.userIp,
        userAgent: clientUserAgent || source?.userAgent,
        limitedDataUse: geoPrivacy.shouldApplyLDU || source?.limitedDataUse,
        geoCountry: geoPrivacy.country,
        geoRegion: geoPrivacy.region,
      }
    : clientIp || clientUserAgent || geoPrivacy.shouldApplyLDU
      ? {
          userIp: clientIp,
          userAgent: clientUserAgent,
          limitedDataUse: geoPrivacy.shouldApplyLDU,
          geoCountry: geoPrivacy.country,
          geoRegion: geoPrivacy.region,
        }
      : null;

  const transactionDiscountMetadata =
    shouldApplyServerDerivedDiscount && lineDiscounts
      ? {
          lineDiscounts,
          ...(transactionDiscountNonce
            ? { nonce: transactionDiscountNonce }
            : {}),
          version: 3 as const,
          ...(transactionDiscountProof
            ? { proof: transactionDiscountProof }
            : {}),
        }
      : null;

  return transactionDiscountMetadata
    ? {
        ...(adTrackingBase ?? {}),
        [TRANSACTION_DISCOUNT_METADATA_KEY]: transactionDiscountMetadata,
      }
    : adTrackingBase;
}
