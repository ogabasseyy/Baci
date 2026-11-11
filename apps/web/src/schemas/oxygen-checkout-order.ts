import { z } from 'zod';

const amount = z
  .union([z.number(), z.string().trim().min(1)])
  .transform((value) => Number(value))
  .pipe(z.number().finite().nonnegative());
export const oxygenCheckoutOrderSchema = z
  .object({
    id: z.uuid(),
    customer_name: z.string().nullable(),
    customer_email: z.string().nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    subtotal: amount,
    shipping_fee: amount,
    tax_amount: amount,
    total: amount,
    wallet_amount_used: amount.nullish().transform((value) => value ?? 0),
    order_items: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        image_url: z.string().nullable().optional(),
        products: z
          .union([
            z.object({ images: z.unknown().optional() }),
            z.array(z.object({ images: z.unknown().optional() })),
          ])
          .nullable()
          .optional(),
        quantity: z.number().positive(),
        price: amount,
      })
    ),
  })
  .refine((order) => order.wallet_amount_used < order.total, {
    message: 'Oxygen checkout requires a positive balance after wallet credit',
    path: ['wallet_amount_used'],
  });
