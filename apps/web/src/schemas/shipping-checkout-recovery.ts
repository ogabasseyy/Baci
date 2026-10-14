import { z } from 'zod';

export const shippingCheckoutRecoverySchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('preview'),
    receiver: z.strictObject({
      address: z.string().trim().min(1).max(500),
      city: z.string().trim().min(1).max(120),
      state: z.string().trim().min(1).max(120),
      phone: z.string().trim().min(10).max(30),
      countryCode: z.string().trim().max(8).optional(),
      latitude: z.number().finite().min(-90).max(90),
      longitude: z.number().finite().min(-180).max(180),
    }),
  }),
  z.strictObject({
    action: z.literal('confirm'),
    previewId: z.uuid(),
    confirmDestination: z.literal(true),
  }),
]);

export const shippingRecoveryContextSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  order: z.object({
    id: z.uuid(),
    merchant_id: z.uuid(),
    customer_name: z.string().nullable(),
    customer_email: z.string().nullable(),
    customer_phone: z.string().nullable(),
    shipping_address: z.unknown(),
    shipping_fee: z.number().positive(),
    order_items: z.array(
      z.object({
        name: z.string().nullable(),
        quantity: z.number().nullable(),
        price: z.number().nullable(),
        product_id: z.string().nullable(),
        product: z.object({
          weight_value: z.number().nullable(),
          weight_unit: z.string().nullable(),
          dimensions: z.unknown(),
          commodity_code: z.string().nullable(),
        }),
      })
    ),
  }),
  quote_preference: z
    .object({
      service_tier: z.string().nullable(),
      carrier_name: z.string().nullable(),
      provider_rate_id: z.string().nullable(),
      is_station_pickup: z.boolean().nullable(),
    })
    .nullable(),
});
