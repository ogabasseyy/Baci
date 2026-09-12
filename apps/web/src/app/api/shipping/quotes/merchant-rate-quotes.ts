/**
 * Merchant-configured rate quotes for the quotes route.
 *
 * Bridges the quote request (free-text receiver state, optional advisory
 * subtotal) into the merchant-rates engine: load config via the storefront
 * RPC, match the destination to a zone, compute applicable rates, and map
 * them onto the carrier `ShippingQuote` shape.
 *
 * Fails soft: any load/shape error resolves to an empty list so merchant
 * rates can never take down carrier quoting or checkout.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { computeMerchantRates } from '@/lib/shipping/merchant-rates/compute-rates';
import { getMerchantShippingRatesOrThrow } from '@/lib/shipping/merchant-rates/get-merchant-shipping-rates';
import { matchShippingZone } from '@/lib/shipping/merchant-rates/match-zone';
import { resolveSubdivisionCode } from '@/lib/shipping/merchant-rates/subdivisions';
import { computedRatesToShippingQuotes } from '@/lib/shipping/merchant-rates/to-shipping-quotes';
import type { MerchantShippingRate } from '@/lib/shipping/merchant-rates/types';
import type { ShippingProviderCode, ShippingQuote } from '@/lib/shipping/types';

export interface MerchantRateQuoteInput {
  merchantId: string;
  /** ISO 3166-1 alpha-2 receiver country (any case; normalized here). */
  receiverCountryCode: string;
  /** Free-text receiver state ("Lagos", "FCT - Abuja"); resolved to ISO 3166-2. */
  receiverState?: string | null;
  /**
   * The merchant's CURRENT canonical currency
   * (`resolveMerchantCurrencyConfig(...).code`). Rates stamped in any other
   * currency are stale (the store currency changed after they were saved) and
   * are dropped here so checkout never displays a fee in the wrong currency —
   * order-time verification rejects the same rates fail-closed.
   */
  merchantCurrency: string;
  /**
   * Advisory quote-time cart subtotal (see `QuoteRequestSchema.cart_subtotal`).
   * When absent, `price_tier` rates are unevaluable and EXCLUDED, while
   * `always`-condition rates are still offered at `base_amount`
   * (`free_over_amount` is not applied without a subtotal).
   */
  cartSubtotal?: number;
}

/**
 * Result of {@link getMerchantRateQuotes}: the matched merchant-rate quotes
 * plus the canonical currency/country the SECURITY DEFINER RPC reported for the
 * merchant. The route reads the resolved fields to suppress NGN carrier quotes
 * on the body-only quote path, where it defaulted `merchantCurrency` to NGN
 * without a trusted merchant header and would otherwise merge Lagos-origin NGN
 * carrier quotes into a non-NG checkout.
 */
export interface MerchantRateQuoteResult {
  /** Matched, current-currency merchant-rate quotes ([] on no match/failure). */
  quotes: ShippingQuote[];
  /**
   * Canonical currency the RPC reported for THIS merchant
   * (`resolveMerchantCurrencyConfig(...).code`, upper-cased), or `undefined`
   * when the RPC predates the currency columns or failed — i.e. it revealed
   * nothing new about the merchant's currency and the route keeps its own.
   */
  resolvedCurrency?: string;
  /**
   * The merchant's ISO country the RPC reported (upper-cased), or `undefined`
   * when absent/failed. Paired with `resolvedCurrency` to detect a non-NG
   * merchant the route defaulted to NG on the body-only path.
   */
  resolvedCountry?: string;
  /**
   * `true` when the merchant-rate LOAD FAILED (the SECURITY DEFINER RPC errored,
   * the client threw, or the payload was malformed) and this result is the
   * fail-soft empty set. On a load failure `resolvedCurrency`/`resolvedCountry`
   * are both `undefined`, so the route cannot tell a non-NG merchant (defaulted
   * to NGN on the body-only path) apart from a genuine NG one. The route reads
   * this to FAIL CLOSED on that path — suppressing the NGN carrier quotes rather
   * than risk one being charged in the merchant's now-unknown currency. Absent
   * (`undefined`) on every successful RPC, so the successful NG-merge and non-NG
   * suppress paths are unaffected.
   */
  loadFailed?: boolean;
  /**
   * Merchant-enabled carrier codes from the same anonymous-safe RPC. Missing
   * only while an older RPC deployment is still rolling out; [] is an
   * explicit choice to disable all carrier providers.
   */
  enabledProviderCodes?: ShippingProviderCode[];
}

/**
 * Restrict rates to the subset that is evaluable without a subtotal:
 * `price_tier` rows are dropped (their bounds cannot be checked) and
 * `free_over_amount` is neutralized so the base amount is charged.
 */
function toSubtotalFreeRates(
  rates: MerchantShippingRate[]
): MerchantShippingRate[] {
  return rates
    .filter((rate) => rate.conditionType === 'always')
    .map((rate) => ({ ...rate, freeOverAmount: null }));
}

/**
 * Compute the merchant-configured rate quotes for a quote request. Returns an
 * empty list when the merchant has no matching zone/rates or on any failure.
 */
export async function getMerchantRateQuotes(
  supabase: SupabaseClient,
  input: MerchantRateQuoteInput
): Promise<MerchantRateQuoteResult> {
  try {
    // Fail-LOUD load: an RPC/DB/schema-cache error must reach the catch below so
    // this result carries `loadFailed`. The fail-soft `getMerchantShippingRates`
    // swallows an RPC `{ error }` into an empty payload, which would leave
    // `resolvedCurrency`/`resolvedCountry` undefined AND `loadFailed` unset — the
    // route could then merge NGN carriers for a body-only merchant whose currency
    // is actually unknown. On a SUCCESSFUL RPC this is byte-identical to the
    // fail-soft variant (both parse the same payload).
    const payload = await getMerchantShippingRatesOrThrow(
      supabase,
      input.merchantId
    );
    const { zones, locations, rates } = payload;
    // Drop stale-currency rates: only rates stamped in the store's current
    // canonical currency may be quoted (order-time verification rejects the
    // rest fail-closed, so surfacing them would only produce a re-quote).
    //
    // Prefer the currency the SECURITY DEFINER RPC returned for THIS merchant
    // over the route-passed `merchantCurrency`. For a body-only quote request
    // (root-domain slug storefront, no trusted x-merchant-slug header) the route
    // cannot read the merchants table for an arbitrary body id (anti-enumeration
    // boundary) and defaults `merchantCurrency` to NGN, which would wrongly drop
    // a non-NG merchant's INR/AED rates. The RPC is the merchant-scoped, anon-safe
    // read already performed here, so this adds no extra merchants read. When the
    // RPC predates the currency columns (payload carries neither), fall back to the
    // route-resolved currency — the header/authenticated path, where the route
    // already resolved the real currency from the merchant row, is unchanged
    // because both resolve the same canonical code for the same merchant.
    const rpcResolvedCurrency =
      payload.merchantPayoutCurrency != null || payload.merchantCountry != null
        ? resolveMerchantCurrencyConfig({
            country: payload.merchantCountry,
            payout_currency: payload.merchantPayoutCurrency,
          })
            .code.trim()
            .toUpperCase()
        : undefined;
    // Surface what the RPC discovered so the route can suppress NGN carriers for
    // a body-only non-NG merchant it defaulted to NGN. Both stay `undefined` when
    // the RPC predates the currency columns — the route then keeps its own
    // resolution, so the NG merged path and the header non-NG early-skip are
    // byte-identical. Attached to EVERY non-throwing return (including the empty
    // ones) so the route can suppress even when no rate survives.
    const resolved = {
      resolvedCurrency: rpcResolvedCurrency,
      resolvedCountry:
        payload.merchantCountry?.trim().toUpperCase() || undefined,
      enabledProviderCodes: payload.enabledProviderCodes,
    };
    const expectedCurrency = (rpcResolvedCurrency ?? input.merchantCurrency)
      .trim()
      .toUpperCase();
    const currentCurrencyRates = rates.filter(
      (rate) => rate.currency.trim().toUpperCase() === expectedCurrency
    );
    if (zones.length === 0 || currentCurrencyRates.length === 0) {
      return { quotes: [], ...resolved };
    }

    const countryCode = input.receiverCountryCode.trim().toUpperCase();
    const zone = matchShippingZone(zones, locations, {
      countryCode,
      subdivisionCode: resolveSubdivisionCode(countryCode, input.receiverState),
    });
    if (!zone) {
      return { quotes: [], ...resolved };
    }

    const hasSubtotal = input.cartSubtotal !== undefined;
    const computed = computeMerchantRates(
      hasSubtotal
        ? currentCurrencyRates
        : toSubtotalFreeRates(currentCurrencyRates),
      { zoneId: zone.id, subtotal: input.cartSubtotal ?? 0 }
    );

    return { quotes: computedRatesToShippingQuotes(computed), ...resolved };
  } catch (error) {
    console.error('Failed to compute merchant rate quotes', {
      merchantId: input.merchantId,
      error,
    });
    // Fail closed: signal the load failure so the body-only quote path suppresses
    // NGN carriers instead of merging them for a merchant whose currency this
    // failure left unknown.
    return { quotes: [], loadFailed: true };
  }
}
