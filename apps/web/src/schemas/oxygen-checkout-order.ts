import { z } from 'zod';

const amount = z
  .union([z.number(), z.string().trim().min(1)])
  .transform((value) => Number(value))
  .pipe(z.number().finite().nonnegative());
export const oxygenCheckoutOrderSchema = z.object({
  id: z.uuid(),
  customer_name: z.string().nullable(),
  customer_email: z.string().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  subtotal: amount,
  shipping_fee: amount,
  tax_amount: amount,
  total: amount,
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
});
