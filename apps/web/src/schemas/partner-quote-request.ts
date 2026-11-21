import { z } from 'zod';

export const partnerQuoteRequestSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        listing_id: z.string().trim().min(1).max(128),
        quantity: z.number().int().min(1).max(20),
      })
    )
    .min(1)
    .max(20)
    .refine(
      (items) =>
        new Set(items.map((item) => item.listing_id)).size === items.length,
      'Duplicate listing ID'
    ),
  destination: z.strictObject({
    address_line1: z.string().trim().min(1).max(256),
    address_line2: z.string().trim().min(1).max(256).optional(),
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().min(1).max(100),
    country_code: z.literal('NG'),
    postal_code: z.string().trim().min(1).max(16).optional(),
    coordinates: z
      .strictObject({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .optional(),
  }),
});
