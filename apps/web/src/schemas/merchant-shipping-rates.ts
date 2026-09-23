/**
 * Defensive parsing for the `get_storefront_shipping_rates` RPC payload.
 *
 * The RPC returns raw snake_case jsonb `{ zones, locations, rates }`. This
 * schema normalizes it into the camelCase engine types
 * (`@/lib/shipping/merchant-rates/types`) and drops malformed rows rather than
 * throwing, so a single bad row can never break checkout.
 */

import { z } from 'zod';
import type {
  MerchantPickupAddress,
  MerchantRateConditionType,
  MerchantRateKind,
  MerchantShippingRate,
  MerchantShippingZone,
  MerchantShippingZoneLocation,
  StorefrontShippingRatesPayload,
} from '@/lib/shipping/merchant-rates/types';
import {
  SHIPPING_PROVIDER_CODES,
  type ShippingProviderCode,
} from '@/lib/shipping/types';

// Runtime enum tuples — single source of truth is the union types in types.ts;
// `satisfies` keeps these in lock-step with them.
export const MERCHANT_SHIPPING_RATE_KINDS = [
  'ship',
  'pickup',
] as const satisfies readonly MerchantRateKind[];

export const MERCHANT_SHIPPING_CONDITION_TYPES = [
  'always',
  'price_tier',
] as const satisfies readonly MerchantRateConditionType[];

// ---------------------------------------------------------------------------
// Reusable numeric coercers (jsonb numerics can arrive as number or string).
// ---------------------------------------------------------------------------

const emptyToNull = (value: unknown): unknown =>
  value === '' || value === undefined ? null : value;

const emptyToZero = (value: unknown): unknown =>
  value === '' || value === null || value === undefined ? 0 : value;

const requiredAmountSchema = z.preprocess(
  emptyToZero,
  z.coerce.number().nonnegative().catch(0)
);

const nullableAmountSchema = z.preprocess(
  emptyToNull,
  z.coerce.number().nonnegative().nullable().catch(null)
);

const nullableIntSchema = z.preprocess(
  emptyToNull,
  z.coerce.number().int().nonnegative().nullable().catch(null)
);

const sortOrderSchema = z.preprocess(
  emptyToZero,
  z.coerce.number().int().catch(0)
);

// Optional merchant currency/country the RPC now returns alongside the rates.
// Any non-string / blank value normalizes to `undefined` so the loader falls
// back to the route-resolved currency (backward-compat with the pre-migration
// RPC that returned neither field). Not uppercased here: the downstream
// `resolveMerchantCurrencyConfig` normalizes casing itself.
const optionalMerchantTextSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional().catch(undefined));

function isShippingProviderCode(value: string): value is ShippingProviderCode {
  return (SHIPPING_PROVIDER_CODES as readonly string[]).includes(value);
}

const optionalShippingProviderCodesSchema = z
  .unknown()
  .optional()
  .transform((value): ShippingProviderCode[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) return [];

    return Array.from(
      new Set(
        value.flatMap((provider) => {
          if (typeof provider !== 'string') return [];
          const normalized = provider.trim().toUpperCase();
          return isShippingProviderCode(normalized) ? [normalized] : [];
        })
      )
    );
  });

// ---------------------------------------------------------------------------
// Row schemas (snake_case in -> camelCase out).
// ---------------------------------------------------------------------------

const zoneSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().catch(''),
    is_rest_of_world: z.boolean().catch(false),
    active: z.boolean().catch(true),
  })
  .transform(
    (row): MerchantShippingZone => ({
      id: row.id,
      name: row.name,
      isRestOfWorld: row.is_rest_of_world,
      active: row.active,
    })
  );

const locationSchema = z
  .object({
    zone_id: z.string().min(1),
    country_code: z.string().min(1),
    subdivision_code: z.string().nullish(),
  })
  .transform(
    (row): MerchantShippingZoneLocation => ({
      zoneId: row.zone_id,
      countryCode: row.country_code,
      subdivisionCode: row.subdivision_code ?? null,
    })
  );

const pickupAddressSchema = z
  .preprocess(
    (value) => (value && typeof value === 'object' ? value : null),
    z
      .object({
        label: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        countryCode: z.string().optional(),
        country_code: z.string().optional(),
        instructions: z.string().optional(),
      })
      .partial()
      .passthrough()
      .nullable()
      .catch(null)
  )
  .transform((value): MerchantPickupAddress | null => {
    if (!value) {
      return null;
    }
    const address: MerchantPickupAddress = {};
    if (value.label) address.label = value.label;
    if (value.address) address.address = value.address;
    if (value.city) address.city = value.city;
    if (value.state) address.state = value.state;
    const countryCode = value.countryCode ?? value.country_code;
    if (countryCode) address.countryCode = countryCode;
    if (value.instructions) address.instructions = value.instructions;
    return address;
  });

const rateSchema = z
  .object({
    id: z.string().min(1),
    zone_id: z.string().min(1),
    name: z.string().catch(''),
    kind: z.enum(MERCHANT_SHIPPING_RATE_KINDS).catch('ship'),
    currency: z
      .string()
      .regex(/^[a-zA-Z]{3}$/)
      .transform((value) => value.toUpperCase()),
    base_amount: requiredAmountSchema,
    condition_type: z.enum(MERCHANT_SHIPPING_CONDITION_TYPES).catch('always'),
    min_subtotal: nullableAmountSchema,
    max_subtotal: nullableAmountSchema,
    free_over_amount: nullableAmountSchema,
    delivery_min_days: nullableIntSchema,
    delivery_max_days: nullableIntSchema,
    pickup_address: pickupAddressSchema,
    sort_order: sortOrderSchema,
    active: z.boolean().catch(true),
  })
  .transform(
    (row): MerchantShippingRate => ({
      id: row.id,
      zoneId: row.zone_id,
      name: row.name,
      kind: row.kind,
      currency: row.currency,
      baseAmount: row.base_amount,
      conditionType: row.condition_type,
      minSubtotal: row.min_subtotal,
      maxSubtotal: row.max_subtotal,
      freeOverAmount: row.free_over_amount,
      deliveryMinDays: row.delivery_min_days,
      deliveryMaxDays: row.delivery_max_days,
      pickupAddress: row.pickup_address,
      sortOrder: row.sort_order,
      active: row.active,
    })
  );

// Parse each element independently; drop the ones that fail validation.
function dropInvalid<Schema extends z.ZodType>(itemSchema: Schema) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items.flatMap((item) => {
        const result = itemSchema.safeParse(item);
        return result.success ? [result.data] : [];
      })
    );
}

export const storefrontShippingRatesPayloadSchema = z
  .object({
    zones: dropInvalid(zoneSchema),
    locations: dropInvalid(locationSchema),
    rates: dropInvalid(rateSchema),
    merchant_payout_currency: optionalMerchantTextSchema,
    merchant_country: optionalMerchantTextSchema,
    shipping_providers: optionalShippingProviderCodesSchema,
  })
  .transform(
    (payload): StorefrontShippingRatesPayload => ({
      zones: payload.zones,
      locations: payload.locations,
      rates: payload.rates,
      merchantPayoutCurrency: payload.merchant_payout_currency,
      merchantCountry: payload.merchant_country,
      enabledProviderCodes: payload.shipping_providers,
    })
  );

/**
 * Parse an unknown RPC payload into a normalized `StorefrontShippingRatesPayload`.
 * Always returns a valid (possibly empty) payload — never throws.
 */
export function parseStorefrontShippingRatesPayload(
  value: unknown
): StorefrontShippingRatesPayload {
  const parsed = storefrontShippingRatesPayloadSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : { zones: [], locations: [], rates: [] };
}
