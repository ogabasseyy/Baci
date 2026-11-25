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
  amount_paid: amount.optional(),
  wallet_amount_used: amount.optional(),
  payment_status: z.string().optional(),
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

export function getOxygenOrderPreGatewayPaid(
  order: Pick<
    z.infer<typeof oxygenCheckoutOrderSchema>,
    'total' | 'amount_paid' | 'wallet_amount_used' | 'payment_status'
  >
): number {
  if ((order.payment_status ?? 'unpaid') !== 'unpaid') {
    return Math.min(Math.max(order.wallet_amount_used ?? 0, 0), order.total);
  }
  return Math.max(order.amount_paid ?? 0, order.wallet_amount_used ?? 0, 0);
}

export function getOxygenOrderNetPayable(
  order: Pick<
    z.infer<typeof oxygenCheckoutOrderSchema>,
    'total' | 'amount_paid' | 'wallet_amount_used' | 'payment_status'
  >
): number {
  return Math.max(
    Number((order.total - getOxygenOrderPreGatewayPaid(order)).toFixed(2)),
    0
  );
}
