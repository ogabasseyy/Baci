import type { SupabaseClient } from '@supabase/supabase-js';
import { validateAirportDeliveryAddress } from '@/lib/checkout/airport-delivery-address';
import { getLocalAirportDeliveryFee } from '@/lib/checkout/airport-delivery-fee';
import { isAmbiguousMetadataFreeAirportFee } from '@/lib/checkout/airport-delivery-fee-ambiguity';
import { getLegacyAirportType } from '@/lib/checkout/airport-delivery-legacy-marker';
import { isConfirmedLocalAirportReplay } from '@/lib/checkout/is-confirmed-local-airport-replay';
import { isLegacyMobileAirportDeliveryRequest } from '@/lib/checkout/is-legacy-mobile-airport-delivery';
import { isSelectedAirportQuote } from '@/lib/checkout/is-selected-airport-quote';
import type { LocalAirportDeliveryFeeValidationResult } from '@/lib/checkout/local-airport-delivery-fee-validation-result';
import { LocalAirportDeliveryValidationError } from '@/lib/checkout/local-airport-delivery-validation-error';
import { resolveLegacyAirportDeliveryMetadata } from '@/lib/checkout/resolve-legacy-airport-delivery-metadata';
import { validateLocalAirportFeeMismatch } from '@/lib/checkout/validate-local-airport-fee-mismatch';
import { validateSelectedAirportQuote } from '@/lib/checkout/validate-selected-airport-quote';

type AirportType = 'delivery' | 'pickup';

interface ValidateLocalAirportDeliveryFeeInput {
  airportType?: AirportType;
  deliveryMethod?: string;
  merchantId: string;
  requestIdempotencyKey?: string | null;
  selectedQuoteId?: string | null;
  shippingAddress?: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
  shippingFee: number;
  shippingProvider?: string | null;
  shippingRateId?: string | null;
  source?: string;
  supabase: SupabaseClient;
}

/** Validate fixed-fee airport delivery and airport-backed provider quotes. */
export async function validateLocalAirportDeliveryFee({
  airportType,
  deliveryMethod,
  merchantId,
  requestIdempotencyKey,
  selectedQuoteId,
  shippingAddress,
  shippingFee,
  shippingProvider,
  shippingRateId,
  source,
  supabase,
}: ValidateLocalAirportDeliveryFeeInput): Promise<LocalAirportDeliveryFeeValidationResult> {
  let resolvedDeliveryMethod = deliveryMethod;
  let resolvedAirportType = airportType;
  const legacyAirportType = getLegacyAirportType(shippingAddress?.address);
  const isLegacyMobileAirportDelivery = isLegacyMobileAirportDeliveryRequest({
    address: shippingAddress?.address,
    airportType,
    deliveryMethod,
    selectedQuoteId,
    shippingFee,
    shippingRateId,
    source,
  });
  if (
    legacyAirportType !== null &&
    deliveryMethod !== undefined &&
    (deliveryMethod !== 'airport' ||
      (airportType !== undefined && airportType !== legacyAirportType) ||
      (selectedQuoteId && legacyAirportType !== 'delivery'))
  ) {
    throw new LocalAirportDeliveryValidationError(
      'Delivery metadata conflicts with the airport address',
      'DELIVERY_METADATA_MISMATCH',
      400
    );
  }

  // Resolve fixed-fee legacy markers before address validation. New requests
  // still need a concrete destination, while confirmed replays may retain
  // the synthetic marker used by older clients.
  const legacyFixedAirportMetadata = resolveLegacyAirportDeliveryMetadata({
    deliveryMethod,
    legacyAirportType,
    selectedQuoteId,
    shippingRateId,
  });
  if (legacyFixedAirportMetadata) {
    resolvedDeliveryMethod = legacyFixedAirportMetadata.resolvedDeliveryMethod;
    resolvedAirportType = legacyFixedAirportMetadata.resolvedAirportType;
  }

  // Older web clients omitted delivery metadata while sending a provider
  // quote. Probe the merchant-scoped idempotency key before relying on the
  // quote row for classification: cleanup may have removed the row before a
  // retry arrives. This is replay evidence only; it never classifies a new
  // fee-only request as airport delivery.
  const isConfirmedMetadataFreeProviderReplay =
    selectedQuoteId && deliveryMethod === undefined
      ? await isConfirmedLocalAirportReplay({
          merchantId,
          requestIdempotencyKey,
          supabase,
        })
      : false;

  // Provider-backed airport quotes cannot be relabeled as non-airport orders.
  if (selectedQuoteId && deliveryMethod !== 'airport') {
    const selectedQuoteIsAirport = await isSelectedAirportQuote({
      merchantId,
      selectedQuoteId,
      supabase,
    });
    if (selectedQuoteIsAirport) {
      if (deliveryMethod === undefined) {
        // Promote the server-verified quote discriminator for persistence.
        resolvedDeliveryMethod = 'airport';
        resolvedAirportType = 'delivery';
      } else {
        throw new LocalAirportDeliveryValidationError(
          'Airport provider quotes require airport delivery',
          'DELIVERY_METADATA_MISMATCH',
          400
        );
      }
    }

    // A deleted quote cannot safely identify airport delivery (the same
    // legacy shape was also used by ordinary carrier checkouts). Preserve the
    // keyed replay without relabeling the order or inferring a fee. The order
    // RPC's idempotency hash remains the authority for conflict detection.
    if (deliveryMethod === undefined && isConfirmedMetadataFreeProviderReplay) {
      return {
        isIdempotentLocalAirportReplay: false,
        isIdempotentOrderReplay: true,
        localAirportShippingFee: null,
      };
    }
  }

  if (resolvedDeliveryMethod === 'airport' && shippingRateId) {
    throw new LocalAirportDeliveryValidationError(
      'Merchant shipping rates cannot be used for airport delivery',
      'AIRPORT_QUOTE_INVALID',
      400
    );
  }

  const resolvedDeliveryMetadata =
    deliveryMethod === undefined && resolvedDeliveryMethod === 'airport'
      ? {
          resolvedDeliveryMethod: 'airport' as const,
          resolvedAirportType: (resolvedAirportType ??
            'delivery') as AirportType,
        }
      : {};

  if (resolvedDeliveryMethod === 'airport' && selectedQuoteId) {
    if (resolvedAirportType === 'pickup') {
      throw new LocalAirportDeliveryValidationError(
        'Provider-backed airport quotes require airport delivery',
        'DELIVERY_METADATA_MISMATCH',
        400
      );
    }

    const isConfirmedReplay = await isConfirmedLocalAirportReplay({
      merchantId,
      requestIdempotencyKey,
      supabase,
    });
    if (!isConfirmedReplay) {
      validateAirportDeliveryAddress({
        airportType: 'delivery',
        deliveryMethod: 'airport',
        selectedQuoteId,
        shippingAddress,
        shippingRateId,
      });
    }

    const isQuoteReplay = await validateSelectedAirportQuote({
      merchantId,
      requestIdempotencyKey,
      selectedQuoteId,
      shippingFee,
      shippingProvider,
      supabase,
    });
    return {
      ...resolvedDeliveryMetadata,
      isIdempotentLocalAirportReplay: isConfirmedReplay || isQuoteReplay,
      localAirportShippingFee: null,
    };
  }

  const localAirportShippingFee = getLocalAirportDeliveryFee({
    airportType: resolvedAirportType,
    deliveryMethod: resolvedDeliveryMethod,
    selectedQuoteId,
    shippingAddress,
    shippingRateId,
  });

  const isConfirmedLegacyFixedReplay = legacyFixedAirportMetadata
    ? await isConfirmedLocalAirportReplay({
        merchantId,
        requestIdempotencyKey,
        supabase,
      })
    : false;
  let isIdempotentLocalAirportReplay = isConfirmedLegacyFixedReplay;
  if (legacyFixedAirportMetadata && !isIdempotentLocalAirportReplay) {
    isIdempotentLocalAirportReplay = await validateLocalAirportFeeMismatch({
      isLegacyMobileAirportDelivery,
      localAirportShippingFee,
      merchantId,
      requestIdempotencyKey,
      shippingFee,
      supabase,
    });
  }

  if (!isIdempotentLocalAirportReplay) {
    validateAirportDeliveryAddress({
      airportType: resolvedAirportType,
      deliveryMethod: resolvedDeliveryMethod,
      selectedQuoteId,
      shippingAddress,
      shippingRateId,
    });
  }

  if (
    localAirportShippingFee === null &&
    isAmbiguousMetadataFreeAirportFee({
      airportType: resolvedAirportType,
      deliveryMethod: resolvedDeliveryMethod,
      selectedQuoteId,
      shippingFee,
      shippingRateId,
    })
  ) {
    const isAmbiguousMetadataReplay = await isConfirmedLocalAirportReplay({
      merchantId,
      requestIdempotencyKey,
      supabase,
    });
    if (!isAmbiguousMetadataReplay) {
      throw new LocalAirportDeliveryValidationError(
        'Delivery metadata is required for this checkout amount',
        'DELIVERY_METADATA_REQUIRED',
        400
      );
    }
    return {
      isIdempotentLocalAirportReplay: true,
      localAirportShippingFee: null,
    };
  }

  if (localAirportShippingFee !== null && !legacyFixedAirportMetadata) {
    isIdempotentLocalAirportReplay = await validateLocalAirportFeeMismatch({
      isLegacyMobileAirportDelivery,
      localAirportShippingFee,
      merchantId,
      requestIdempotencyKey,
      shippingFee,
      supabase,
    });
  }

  return {
    ...(legacyFixedAirportMetadata ?? resolvedDeliveryMetadata),
    isIdempotentLocalAirportReplay,
    localAirportShippingFee,
  };
}
