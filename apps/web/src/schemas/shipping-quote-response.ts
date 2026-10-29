import z from 'zod';
import {
  MERCHANT_PROVIDER_CODE,
  SHIPPING_PROVIDER_CODES,
} from '@/lib/shipping/types';
import type { ShippingQuote } from '@/types/shipping-quote';
import { homeDeliveryCoverageSchema } from './gigl-address-validation';

interface NormalizedShippingQuoteResponse {
  quotes: ShippingQuote[];
  sessionId: string;
  warnings: string[];
}

/**
 * Provider codes a storefront client may receive in a quote payload: the
 * registered carriers plus computed merchant-configured rates. This mirrors
 * `QuoteProviderCode`; `SHIPPING_PROVIDER_CODES` itself deliberately stays
 * carrier-only because it gates booking/persistence paths.
 */
const QUOTE_PROVIDER_CODES = [
  ...SHIPPING_PROVIDER_CODES,
  MERCHANT_PROVIDER_CODE,
] as const;

const nullableOptionalNumberSchema = z
  .number()
  .int()
  .nonnegative()
  .nullable()
  .optional()
  .transform((value) => value ?? undefined);

const nullableOptionalStringSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? undefined);

const nullableOptionalBooleanSchema = z
  .boolean()
  .nullable()
  .optional()
  .transform((value) => value ?? undefined);

const shippingQuoteSchema = z
  .object({
    id: z.string().min(1),
    provider: z.enum(QUOTE_PROVIDER_CODES),
    serviceTier: z.string().min(1),
    carrierName: z.string().min(1),
    displayName: z.string().min(1),
    estimatedDays: z.number().int().nonnegative(),
    deliveryRange: nullableOptionalStringSchema,
    minDays: nullableOptionalNumberSchema,
    maxDays: nullableOptionalNumberSchema,
    price: z.number().nonnegative(),
    currency: z.string().min(1),
    pickupIncluded: z.boolean(),
    insuranceIncluded: z.boolean(),
    isStationPickup: nullableOptionalBooleanSchema,
    homeDeliveryCoverage: homeDeliveryCoverageSchema
      .nullish()
      .transform((value) => value ?? undefined),
    stationName: nullableOptionalStringSchema,
    stationAddress: nullableOptionalStringSchema,
    stationInstructions: nullableOptionalStringSchema,
    stationCode: nullableOptionalStringSchema,
    providerRateId: nullableOptionalStringSchema,
  })
  .transform((quote): ShippingQuote => {
    const normalized: ShippingQuote = {
      id: quote.id,
      provider: quote.provider,
      serviceTier: quote.serviceTier,
      carrierName: quote.carrierName,
      displayName: quote.displayName,
      estimatedDays: quote.estimatedDays,
      price: quote.price,
      currency: quote.currency,
      pickupIncluded: quote.pickupIncluded,
      insuranceIncluded: quote.insuranceIncluded,
    };

    if (quote.deliveryRange !== undefined) {
      normalized.deliveryRange = quote.deliveryRange;
    }
    if (quote.minDays !== undefined) {
      normalized.minDays = quote.minDays;
    }
    if (quote.maxDays !== undefined) {
      normalized.maxDays = quote.maxDays;
    }
    if (quote.isStationPickup !== undefined) {
      normalized.isStationPickup = quote.isStationPickup;
    }
    if (quote.homeDeliveryCoverage !== undefined) {
      normalized.homeDeliveryCoverage = quote.homeDeliveryCoverage;
    }
    if (quote.stationName !== undefined) {
      normalized.stationName = quote.stationName;
    }
    if (quote.stationAddress !== undefined) {
      normalized.stationAddress = quote.stationAddress;
    }
    if (quote.stationInstructions !== undefined) {
      normalized.stationInstructions = quote.stationInstructions;
    }
    if (quote.stationCode !== undefined) {
      normalized.stationCode = quote.stationCode;
    }
    if (quote.providerRateId !== undefined) {
      normalized.providerRateId = quote.providerRateId;
    }

    return normalized;
  });

type ParsedShippingQuote = z.infer<typeof shippingQuoteSchema>;

const maybeShippingQuoteSchema = z.unknown().transform((quote) => {
  const parsed = shippingQuoteSchema.safeParse(quote);
  return parsed.success ? parsed.data : undefined;
});

const shippingQuoteArraySchema = z
  .array(maybeShippingQuoteSchema)
  .transform((quotes) =>
    quotes.filter((quote): quote is ParsedShippingQuote => quote !== undefined)
  );

const shippingQuoteContainerSchema = z
  .object({
    all: shippingQuoteArraySchema.catch([]).default([]),
  })
  .passthrough();

const maybeWarningSchema = z
  .unknown()
  .transform((warning) => (typeof warning === 'string' ? warning : undefined));

const warningArraySchema = z
  .array(maybeWarningSchema)
  .transform((warnings) =>
    warnings.filter((warning): warning is string => warning !== undefined)
  );

export const shippingQuoteApiResponseSchema = z
  .object({
    quotes: z
      .union([shippingQuoteArraySchema, shippingQuoteContainerSchema])
      .catch([])
      .default([]),
    sessionId: z.string().catch('').default(''),
    warnings: warningArraySchema.catch([]).default([]),
  })
  .passthrough();

export function normalizeShippingQuoteResponsePayload(
  response: unknown
): NormalizedShippingQuoteResponse {
  const parsed = shippingQuoteApiResponseSchema.safeParse(response);

  if (!parsed.success) {
    return { quotes: [], sessionId: '', warnings: [] };
  }

  const quoteValue = parsed.data.quotes;

  return {
    quotes: Array.isArray(quoteValue) ? quoteValue : quoteValue.all,
    sessionId: parsed.data.sessionId,
    warnings: parsed.data.warnings,
  };
}
