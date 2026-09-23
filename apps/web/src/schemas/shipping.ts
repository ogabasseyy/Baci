/**
 * Shipping API Validation Schemas
 * Centralized schemas for shipping-related API routes
 */

import z, { type RefinementCtx } from 'zod';
import { isValidUuid } from '@/lib/sanitize-core';

const LatitudeSchema = z.number().finite().min(-90).max(90).optional();
const LongitudeSchema = z.number().finite().min(-180).max(180).optional();

interface CoordinateFields {
  latitude?: number;
  longitude?: number;
}

function requireCoordinatePair(
  address: CoordinateFields,
  ctx: RefinementCtx,
  path: (string | number)[] = []
) {
  const hasLatitude = address.latitude !== undefined;
  const hasLongitude = address.longitude !== undefined;
  if (hasLatitude === hasLongitude) return;

  ctx.addIssue({
    code: 'custom',
    message: 'Latitude and longitude must be provided together',
    path: [...path, hasLatitude ? 'longitude' : 'latitude'],
  });
}

/**
 * Address schema for shipping sender/receiver
 */
const AddressSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.email().optional(),
    phone: z.string().min(10, 'Phone must be at least 10 digits'),
    address: z.string().min(5, 'Address must be at least 5 characters'),
    city: z.string().min(2, 'City must be at least 2 characters'),
    state: z.string().min(2, 'State must be at least 2 characters'),
    country: z.string().default('Nigeria'),
    countryCode: z.string().default('NG'),
    postalCode: z.string().optional(),
    latitude: LatitudeSchema,
    longitude: LongitudeSchema,
    stationId: z.number().optional(),
  })
  .superRefine((address, ctx) => requireCoordinatePair(address, ctx));

/**
 * Shipping item schema
 */
const ShippingItemSchema = z
  .object({
    name: z.string().min(1),
    quantity: z.number().int().positive(),
    weight: z.number().positive(),
    value: z.number().nonnegative(),
    category: z.string().optional(),
    hsCode: z.string().optional(),
    length: z.number().positive().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
  })
  .superRefine((item, ctx) => {
    const dimensionKeys = ['length', 'width', 'height'] as const;
    const providedCount = dimensionKeys.filter(
      (key) => item[key] !== undefined
    ).length;
    if (providedCount === 0 || providedCount === dimensionKeys.length) return;

    for (const key of dimensionKeys) {
      if (item[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'Length, width, and height must be provided together',
          path: [key],
        });
      }
    }
  });

const DispatchPhoneStringSchema = z
  .string()
  .trim()
  .min(10, 'Phone number must be at least 10 digits');

const normalizeBlankDispatchPhone =
  (emptyValue: null | undefined) => (value: unknown) =>
    value === null || (typeof value === 'string' && value.trim() === '')
      ? emptyValue
      : value;

const OptionalDispatchPhoneSchema = z.preprocess(
  normalizeBlankDispatchPhone(undefined),
  DispatchPhoneStringSchema.optional()
);

const OptionalDispatchPhoneUpdateSchema = z.preprocess(
  normalizeBlankDispatchPhone(null),
  DispatchPhoneStringSchema.nullable().optional()
);

// Quote-time requests are allowed to be lighter than booking requests because
// domestic quote calls can be completed with merchant defaults before checkout.
const BaseQuoteAddressSchema = z.object({
  name: z.string().min(1),
  email: z.email().optional(),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  country: z.string().optional(),
  countryCode: z.string().optional(),
  postalCode: z.string().optional(),
  latitude: LatitudeSchema,
  longitude: LongitudeSchema,
  stationId: z.number().optional(),
});

const QuoteReceiverAddressSchema = BaseQuoteAddressSchema.extend({
  phone: z.string().optional(),
});

const QuoteSenderAddressSchema = BaseQuoteAddressSchema.extend({
  phone: z.string().min(1),
});

function defaultBlank(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

export const QuoteRequestSchema = z
  .object({
    receiver: QuoteReceiverAddressSchema,
    sender: QuoteSenderAddressSchema.optional(),
    items: z.array(ShippingItemSchema).min(1),
    merchantId: z
      .string()
      .refine(isValidUuid, { message: 'Invalid merchant ID' })
      .optional(),
    sessionId: z.string().optional(),
    shipmentType: z.enum(['domestic', 'international']).default('domestic'),
    deliveryPreference: z.enum(['door', 'pickup_station']).optional(),
    /**
     * Advisory cart subtotal (merchant-currency major units), used only to
     * evaluate merchant-configured rate conditions at quote time. Client
     * threading arrives in a later wave, so absence is expected and means:
     * - `price_tier` rates cannot be evaluated and are EXCLUDED;
     * - `always`-condition rates are still offered;
     * - `free_over_amount` is NOT applied (the base amount is charged).
     * Order creation re-derives the fee from the canonical server-verified
     * subtotal regardless of this value, so it is never trusted for money.
     */
    cart_subtotal: z.number().nonnegative().optional(),
    /**
     * Opt-in capability flag: the CALLER promises it can carry a merchant
     * rate's synthetic `mrate_<uuid>` id back into order creation (as
     * `shipping_rate_id`). Only clients that set this true receive
     * merchant-configured rates in the response; when false/absent the route
     * still resolves the merchant's currency (to correctly gate/suppress the
     * NGN carriers) but never merges merchant rates into the returned quotes.
     *
     * Maintained web and mobile checkout clients set this flag and convert a
     * selected `mrate_<uuid>` quote into a bare `shipping_rate_id` at order
     * creation. Older or third-party clients can leave it absent until they
     * implement that same order contract.
     */
    supports_merchant_rates: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    requireCoordinatePair(data.receiver, ctx, ['receiver']);
    if (data.sender) requireCoordinatePair(data.sender, ctx, ['sender']);
    if (data.shipmentType !== 'international') return;
    if (!data.receiver.country?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Receiver country is required for international quotes',
        path: ['receiver', 'country'],
      });
    }
    if (!data.receiver.countryCode?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Receiver country code is required for international quotes',
        path: ['receiver', 'countryCode'],
      });
    }
    data.items.forEach((item, index) => {
      if (!item.hsCode?.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: 'HS code is required for international quotes',
          path: ['items', index, 'hsCode'],
        });
      }
    });
  })
  .transform((data) => ({
    ...data,
    receiver: {
      ...data.receiver,
      country: defaultBlank(data.receiver.country, 'Nigeria'),
      countryCode: defaultBlank(data.receiver.countryCode, 'NG'),
    },
    sender: data.sender
      ? {
          ...data.sender,
          country: defaultBlank(data.sender.country, 'Nigeria'),
          countryCode: defaultBlank(data.sender.countryCode, 'NG'),
        }
      : undefined,
  }));

/**
 * Schema for booking a shipment with a provider
 */
export const BookingRequestSchema = z.object({
  // Order ID (required)
  orderId: z.string().refine(isValidUuid, { message: 'Invalid order ID' }),
  carrierId: z.string().min(1, 'Carrier ID is required'),
  // Selected quote ID (required)
  quoteId: z.string().refine(isValidUuid, { message: 'Invalid quote ID' }),
  // Receiver info (required)
  receiver: AddressSchema,
  // Sender info (optional - uses merchant address)
  sender: AddressSchema.optional(),
  // Items to ship (required)
  items: z.array(ShippingItemSchema).min(1),
  // Special instructions
  instructions: z.string().optional(),
});

/**
 * Schema for self-fulfillment (merchant's own shipping)
 */
export const SelfFulfillmentSchema = z
  .object({
    // Order ID (required)
    orderId: z.string().refine(isValidUuid, { message: 'Invalid order ID' }),
    // Tracking number (optional but recommended)
    trackingNumber: z.string().min(1).optional(),
    // Dispatch phone number (optional; if provided, must be a full number)
    dispatchPhone: OptionalDispatchPhoneSchema,
    // Carrier name (optional)
    carrierName: z.string().optional(),
    // Notes for dispatch/rider
    dispatchNotes: z.string().optional(),
  })
  .strict();

export const SelfFulfillmentUpdateSchema = z
  .object({
    orderId: z.string().refine(isValidUuid, { message: 'Invalid order ID' }),
    carrierName: z.string().optional(),
    dispatchNotes: z.string().optional(),
    dispatchPhone: OptionalDispatchPhoneUpdateSchema,
    trackingNumber: z.string().min(1).optional(),
  })
  .strict();

/**
 * Schema for shipping locations query params
 */
export const locationsQuerySchema = z.object({
  state: z.string().optional(),
  search: z.string().min(2).optional(),
});

export type QuoteRequestInput = z.input<typeof QuoteRequestSchema>;
export type ParsedQuoteRequest = z.infer<typeof QuoteRequestSchema>;
export type BookingRequestInput = z.infer<typeof BookingRequestSchema>;
export type SelfFulfillmentInput = z.infer<typeof SelfFulfillmentSchema>;
export type SelfFulfillmentUpdateInput = z.infer<
  typeof SelfFulfillmentUpdateSchema
>;
export type LocationsQueryInput = z.infer<typeof locationsQuerySchema>;
