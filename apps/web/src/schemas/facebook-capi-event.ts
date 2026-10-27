import { z } from 'zod';

// Purchases originate only from the server-confirmed paid-order pipeline.
export const facebookCapiEventSchema = z.object({
  event: z.enum(['ViewContent', 'AddToCart', 'InitiateCheckout']),
  merchantId: z.uuid(),
  consent: z.literal(true),
  eventId: z.string().min(1).max(200).optional(),
  eventSourceUrl: z.url().max(2048).optional(),
  eventData: z.object({
    value: z.number().finite().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    products: z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          name: z.string().max(500),
          quantity: z.number().int().positive().max(10000),
          price: z.number().finite().nonnegative(),
        })
      )
      .min(1)
      .max(100),
  }),
});
