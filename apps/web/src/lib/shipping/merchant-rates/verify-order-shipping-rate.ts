/**
 * Order-time server-side verification for merchant-configured shipping rates.
 *
 * When a checkout order carries a `shipping_rate_id`, /api/orders must never
 * trust the client-submitted `shipping_fee`. This helper re-derives the fee
 * authoritatively from the merchant's rate config:
 *   1. load the merchant's zones/locations/rates through the storefront RPC
 *      (anonymous-safe RPC; underlying tables remain protected), failing LOUD:
 *      a load error throws `MerchantShippingRatesLoadError` rather than reading
 *      as an empty rate set (see the return-contract note below),
 *   2. confirm the selected rate exists, is active, and belongs to an active
 *      zone of THIS merchant (a foreign rate id simply won't be in the load),
 *   3. confirm that zone is the MOST-SPECIFIC match for the destination —
 *      a rate from a non-winning zone is rejected, so a shopper cannot pick
 *      the cheap Lagos rate while shipping to Abuja,
 *   4. recompute the fee via the same engine the quotes API uses
 *      (tier bounds + free-over-threshold against the canonical subtotal).
 *
 * Destination resolution — the DOMESTIC ASSUMPTION: checkout collects no
 * country field today (free-text state only), so when the shipping address
 * has no valid ISO 3166-1 alpha-2 country we fall back to the merchant's own
 * country (`merchants.country`) and treat the order as domestic. A present,
 * valid ISO-2 address country always wins over the fallback.
 *
 * Verification VERDICTS are returned as a typed result so the money-path route
 * can map rejections to precise 400 codes. A LOAD failure is different: if the
 * merchant's rate config cannot be loaded (RPC / DB / schema-cache error) this
 * throws `MerchantShippingRatesLoadError` instead of returning an empty
 * payload, so the route surfaces a server outage as a 500 rather than a bogus
 * customer-facing 400 invalid-rate. A successful load with zero rates is still
 * a normal verdict (rejected as an invalid rate, 400).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeMerchantRates } from './compute-rates';
import { getMerchantShippingRatesOrThrow } from './get-merchant-shipping-rates';
import { matchShippingZone } from './match-zone';
import { resolveSubdivisionCode } from './subdivisions';
import type { MerchantPickupAddress, MerchantRateKind } from './types';

export type VerifyOrderShippingRateRejectionCode =
  | 'SHIPPING_RATE_INVALID'
  | 'SHIPPING_RATE_ZONE_MISMATCH'
  | 'SHIPPING_RATE_CONDITION_UNMET';

export interface VerifyOrderShippingRateInput {
  /** Normal public/session client; reads only the anonymous-safe storefront RPC. */
  supabase: SupabaseClient;
  merchantId: string;
  /** The `merchant_shipping_rates.id` the checkout selected. */
  shippingRateId: string;
  /** The order's shipping address fields relevant to zone matching. */
  shippingAddress: {
    /** Free-text state name (e.g. 'Lagos', 'FCT - Abuja'). */
    state?: string | null;
    /** ISO 3166-1 alpha-2 when the client sends one; free text is ignored. */
    country?: string | null;
  };
  /** `merchants.country` — the domestic fallback destination country. */
  merchantCountry: string | null | undefined;
  /**
   * The merchant's CURRENT canonical currency
   * (`resolveMerchantCurrencyConfig(merchant).code`). Each rate is stamped with
   * the store currency at save time; if the store currency has since changed,
   * the stored amount is in the wrong currency and the rate is rejected as
   * stale — the merchant must re-save their rates before we charge again.
   */
  merchantCurrency: string;
  /**
   * Canonical server-verified pre-discount subtotal
   * (`computeCanonicalOrderSubtotal`) — the tamper-proof basis for tier
   * bounds and free-over thresholds.
   */
  canonicalSubtotal: number;
}

export type VerifyOrderShippingRateResult =
  | {
      ok: true;
      /** Server-computed fee (0 when free-over-threshold applied). */
      amount: number;
      rateName: string;
      /** ISO 4217 code stamped on the rate (the merchant's currency). */
      currency: string;
      /**
       * `ship` for carried delivery, `pickup` for shopper collection. The
       * order route stamps a distinct fulfillment provider per kind so a
       * pickup selection can never be fulfilled as a door delivery.
       */
      kind: MerchantRateKind;
      /**
       * For a `pickup` rate, the rate's configured collection address /
       * instructions at order time. The order route snapshots this into
       * `orders.shipping_pickup_details` so the customer + merchant order views
       * retain the collection point even if the rate is later edited or
       * deleted. Omitted (`undefined`) for `ship` rates; `null` when a pickup
       * rate carries no address.
       */
      pickupAddress?: MerchantPickupAddress | null;
    }
  | {
      ok: false;
      code: VerifyOrderShippingRateRejectionCode;
      message: string;
    };

const ISO_3166_ALPHA2_PATTERN = /^[A-Za-z]{2}$/;

/**
 * The destination country for zone matching: the address country when it is a
 * valid ISO-2 code, else the merchant's own country (domestic assumption —
 * see module doc). Empty string when neither resolves.
 */
function resolveDestinationCountry(
  addressCountry: string | null | undefined,
  merchantCountry: string | null | undefined
): string {
  const fromAddress = (addressCountry ?? '').trim();
  if (ISO_3166_ALPHA2_PATTERN.test(fromAddress)) {
    return fromAddress.toUpperCase();
  }
  return (merchantCountry ?? '').trim().toUpperCase();
}

export async function verifyOrderShippingRate(
  input: VerifyOrderShippingRateInput
): Promise<VerifyOrderShippingRateResult> {
  const payload = await getMerchantShippingRatesOrThrow(
    input.supabase,
    input.merchantId
  );

  // Scoped to input.merchantId by the loader, so a rate belonging to another
  // merchant is indistinguishable from an unknown id — both reject here.
  const rate = payload.rates.find(
    (candidate) => candidate.id === input.shippingRateId
  );
  if (!rate?.active) {
    return {
      ok: false,
      code: 'SHIPPING_RATE_INVALID',
      message: 'Selected shipping rate is not available',
    };
  }

  // Stale-rate guard: the rate stored its amount in the store currency at save
  // time. If the store currency has since changed, that amount is now in the
  // wrong currency — reject rather than charge a stale figure. The merchant
  // must re-save their shipping rates in the new currency first.
  if (
    rate.currency.trim().toUpperCase() !==
    input.merchantCurrency.trim().toUpperCase()
  ) {
    return {
      ok: false,
      code: 'SHIPPING_RATE_INVALID',
      message:
        'Selected shipping rate is out of date because the store currency changed; the merchant must re-save their shipping rates',
    };
  }

  const rateZone = payload.zones.find((zone) => zone.id === rate.zoneId);
  if (!rateZone?.active) {
    return {
      ok: false,
      code: 'SHIPPING_RATE_INVALID',
      message: 'Selected shipping rate is not available',
    };
  }

  const countryCode = resolveDestinationCountry(
    input.shippingAddress.country,
    input.merchantCountry
  );
  const subdivisionCode = resolveSubdivisionCode(
    countryCode,
    input.shippingAddress.state ?? null
  );

  // `matchShippingZone` returns null for an empty destination country, so an
  // unresolvable destination fails closed as a zone mismatch — we never
  // charge a fee we could not verify against a destination.
  const winningZone = matchShippingZone(payload.zones, payload.locations, {
    countryCode,
    subdivisionCode,
  });
  if (!winningZone || winningZone.id !== rate.zoneId) {
    return {
      ok: false,
      code: 'SHIPPING_RATE_ZONE_MISMATCH',
      message: 'Selected shipping rate does not serve the delivery address',
    };
  }

  // Same engine as the quotes API: active + zone-scoped + tier bounds
  // (min inclusive / max exclusive) + free-over-threshold, all against the
  // canonical subtotal. A rate missing from the result means its price-tier
  // condition is not met for THIS order's subtotal.
  const computedRates = computeMerchantRates(payload.rates, {
    zoneId: winningZone.id,
    subtotal: input.canonicalSubtotal,
  });
  const computed = computedRates.find((entry) => entry.rate.id === rate.id);
  if (!computed) {
    return {
      ok: false,
      code: 'SHIPPING_RATE_CONDITION_UNMET',
      message: 'Selected shipping rate conditions are not met for this order',
    };
  }

  return {
    ok: true,
    amount: computed.amount,
    rateName: rate.name,
    currency: rate.currency,
    kind: rate.kind,
    // Snapshot the collection point for pickup rates so the order retains it
    // durably; `ship` rates omit the field entirely.
    ...(rate.kind === 'pickup' ? { pickupAddress: rate.pickupAddress } : {}),
  };
}
