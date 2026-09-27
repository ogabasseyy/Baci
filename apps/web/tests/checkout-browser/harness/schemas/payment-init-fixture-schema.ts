import { z } from 'zod';

export const paymentInitFixtureSchema = z.object({
  merchant_id: z.uuid(),
  order_id: z.uuid(),
  currency: z.string().optional(),
  customer_email: z.email(),
  customer_name: z.string().min(1),
  customer_phone: z.string().min(1),
  gateway: z
    .enum([
      'paystack',
      'korapay',
      'juicyway',
      'credit_direct',
      'credpal',
      'klump',
    ])
    .optional(),
  billing_address: z
    .object({
      line1: z.string().min(1).optional(),
      line2: z.string().optional(),
      city: z.string().min(1).optional(),
      state: z.string().optional(),
      country: z.string().length(2),
      zip_code: z.string().min(1).optional(),
    })
    .optional(),
});
