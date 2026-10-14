import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { OrderCreateInput } from '@/schemas/orders';
import {
  buildOrderIdempotencyPayload,
  hashOrderIdempotencyPayload,
  type OrderIdempotencyPayloadInput,
} from './order-idempotency';
import { buildLegacyOrderIdempotencyPayload } from './order-idempotency-legacy';

type CheckoutIdempotencyReplayInput = {
  canonicalAirportType: OrderCreateInput['airport_type'];
  canonicalDeliveryMethod: OrderCreateInput['delivery_method'];
  merchantId: string;
  payload: OrderIdempotencyPayloadInput | null;
  /**
   * Evolving request fields (e.g. a provider backfilled after the original
   * request) change the hash across retries of the same key. Each alternate
   * is probed against the stored hash and the first stored match is adopted,
   * so a retry replays instead of conflicting. Probe errors fail closed.
   */
  alternatePayloads?: OrderIdempotencyPayloadInput[];
  requestIdempotencyKey: string | null;
  supabase: SupabaseClient;
};

type CheckoutIdempotencyReplayResult = {
  checkoutRequestHash: string | null;
  isLegacyIdempotencyReplay: boolean;
};

type StoredCheckoutHashProbe = {
  failureMessage: string;
  merchantId: string;
  requestHash: string;
  requestIdempotencyKey: string;
  supabase: SupabaseClient;
};

async function isStoredCheckoutRequestHash({
  failureMessage,
  merchantId,
  requestHash,
  requestIdempotencyKey,
  supabase,
}: StoredCheckoutHashProbe): Promise<boolean> {
  const { data: hashMatches, error: probeError } = await supabase.rpc(
    'is_storefront_order_idempotency_hash',
    {
      p_checkout_idempotency_key: requestIdempotencyKey,
      p_checkout_request_hash: requestHash,
      p_merchant_id: merchantId,
    }
  );

  if (probeError) {
    // A probe error is not a confirmed miss: falling through would submit
    // the alternate hash under the existing key and turn a transient
    // database blip into an idempotency conflict instead of a replay.
    // Fail closed so the request surfaces a retryable 5xx instead.
    logger.error({
      message: failureMessage,
      merchantId,
      error: probeError,
    });
    throw new Error(failureMessage);
  }
  return hashMatches === true;
}

/**
 * Build the current idempotency hash and, only when the database confirms a
 * pre-metadata order, rebuild the legacy hash used by that original request.
 */
export async function prepareCheckoutIdempotencyReplay({
  alternatePayloads,
  canonicalAirportType,
  canonicalDeliveryMethod,
  merchantId,
  payload,
  requestIdempotencyKey,
  supabase,
}: CheckoutIdempotencyReplayInput): Promise<CheckoutIdempotencyReplayResult> {
  if (!requestIdempotencyKey || !payload) {
    return {
      checkoutRequestHash: null,
      isLegacyIdempotencyReplay: false,
    };
  }

  const checkoutRequestPayload = buildOrderIdempotencyPayload(payload);
  let checkoutRequestHash = hashOrderIdempotencyPayload(checkoutRequestPayload);
  let isLegacyIdempotencyReplay = false;
  const localeRequestHash = hashOrderIdempotencyPayload(
    buildOrderIdempotencyPayload(payload, { itemSort: 'locale' })
  );

  if (localeRequestHash !== checkoutRequestHash) {
    const localeHashStored = await isStoredCheckoutRequestHash({
      failureMessage: 'Locale checkout item-order hash probe failed',
      merchantId,
      requestHash: localeRequestHash,
      requestIdempotencyKey,
      supabase,
    });
    if (localeHashStored) {
      checkoutRequestHash = localeRequestHash;
    }
  }

  // Evolved fields (e.g. a provider backfilled from the validated quote after
  // the original request) change the current hash. Probe each alternate and
  // adopt the first one the database confirms, so a retry whose source row
  // was cleaned up still replays the original order instead of conflicting.
  for (const alternatePayload of alternatePayloads ?? []) {
    const alternateHash = hashOrderIdempotencyPayload(
      buildOrderIdempotencyPayload(alternatePayload)
    );
    if (alternateHash === checkoutRequestHash) continue;
    const alternateStored = await isStoredCheckoutRequestHash({
      failureMessage: 'Alternate checkout request hash probe failed',
      merchantId,
      requestHash: alternateHash,
      requestIdempotencyKey,
      supabase,
    });
    if (alternateStored) {
      checkoutRequestHash = alternateHash;
      break;
    }
  }

  // Delivery metadata was added after the first storefront idempotency hash.
  // Probe the merchant-scoped row before accepting the legacy hash so a new
  // request can never opt itself into the pre-metadata replay form.
  if (canonicalDeliveryMethod || canonicalAirportType) {
    const { data: isLegacyOrder, error: legacyProbeError } = await supabase.rpc(
      'is_legacy_storefront_order_idempotency_key',
      {
        p_checkout_idempotency_key: requestIdempotencyKey,
        p_merchant_id: merchantId,
      }
    );

    if (legacyProbeError) {
      logger.warn({
        message:
          'Legacy checkout idempotency probe failed; using the current request hash',
        merchantId,
        error: legacyProbeError,
      });
    } else if (isLegacyOrder === true) {
      isLegacyIdempotencyReplay = true;
      let legacyHash = hashOrderIdempotencyPayload(
        buildLegacyOrderIdempotencyPayload(payload)
      );
      // Pre-metadata orders were also hashed under locale item ordering, so
      // probe the legacy payload with the legacy sort before accepting it.
      const localeLegacyHash = hashOrderIdempotencyPayload(
        buildLegacyOrderIdempotencyPayload(payload, { itemSort: 'locale' })
      );
      if (localeLegacyHash !== legacyHash) {
        const localeLegacyStored = await isStoredCheckoutRequestHash({
          failureMessage: 'Locale legacy checkout item-order hash probe failed',
          merchantId,
          requestHash: localeLegacyHash,
          requestIdempotencyKey,
          supabase,
        });
        if (localeLegacyStored) {
          legacyHash = localeLegacyHash;
        }
      }
      checkoutRequestHash = legacyHash;
    }
  }

  return { checkoutRequestHash, isLegacyIdempotencyReplay };
}
