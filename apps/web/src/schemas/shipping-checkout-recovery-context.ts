import { z } from 'zod';

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
        fulfillment_quantity: z.number().int().min(0),
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
