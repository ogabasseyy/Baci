import type { SupabaseClient } from '@supabase/supabase-js';
import { isConfirmedLocalAirportReplay } from '@/lib/checkout/is-confirmed-local-airport-replay';
import { LocalAirportDeliveryFeeMismatchError } from '@/lib/checkout/local-airport-delivery-fee-mismatch-error';
import { LocalAirportDeliveryValidationError } from '@/lib/checkout/local-airport-delivery-validation-error';
import { logger } from '@/lib/logger';

interface ValidateLocalAirportFeeMismatchInput {
  isLegacyMobileAirportDelivery: boolean;
  localAirportShippingFee: number | null;
  merchantId: string;
  requestIdempotencyKey?: string | null;
  shippingFee: number;
  supabase: SupabaseClient;
}

/** Enforce the current fixed airport fee without silently repricing clients. */
export async function validateLocalAirportFeeMismatch({
  isLegacyMobileAirportDelivery,
  localAirportShippingFee,
  merchantId,
  requestIdempotencyKey,
  shippingFee,
  supabase,
}: ValidateLocalAirportFeeMismatchInput): Promise<boolean> {
  const hasMismatch =
    localAirportShippingFee !== null &&
    Math.abs(shippingFee - localAirportShippingFee) > 0.01;
  if (!hasMismatch) return false;

  const isIdempotentLocalAirportReplay = await isConfirmedLocalAirportReplay({
    merchantId,
    requestIdempotencyKey,
    supabase,
  });

  // A released mobile client can identify the legacy airport flow, but its
  // stale amount is not consent to silently reprice a new order. A confirmed
  // idempotent replay is safe to return at its original amount.
  if (isLegacyMobileAirportDelivery && !isIdempotentLocalAirportReplay) {
    throw new LocalAirportDeliveryValidationError(
      'The airport delivery fee has changed; refresh checkout before continuing',
      'AIRPORT_FEE_UPDATE_REQUIRED',
      400
    );
  }

  if (!isIdempotentLocalAirportReplay) {
    logger.warn({
      message: 'Storefront order rejected: local airport shipping fee mismatch',
      clientShippingFee: shippingFee,
      serverShippingFee: localAirportShippingFee,
    });
    throw new LocalAirportDeliveryFeeMismatchError(
      shippingFee,
      localAirportShippingFee ?? 0
    );
  }

  return true;
}
