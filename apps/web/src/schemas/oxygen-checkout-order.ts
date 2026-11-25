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
  wallet_ledger_used: amount.optional(),
  savings_ledger_used: amount.optional(),
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

export function sumPositiveLedgerAmounts(rows: unknown): number {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum: number, row) => {
    const raw =
      row && typeof row === 'object'
        ? (row as { amount?: unknown }).amount
        : undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);
}

export function getOxygenOrderPreGatewayPaid(
  order: Pick<
    z.infer<typeof oxygenCheckoutOrderSchema>,
    | 'total'
    | 'amount_paid'
    | 'wallet_amount_used'
    | 'wallet_ledger_used'
    | 'savings_ledger_used'
    | 'payment_status'
  >
): number {
  const walletColumn = Math.max(order.wallet_amount_used ?? 0, 0);
  const walletLedger = Math.max(order.wallet_ledger_used ?? 0, 0);
  const savingsLedger = Math.max(order.savings_ledger_used ?? 0, 0);
  if ((order.payment_status ?? 'unpaid') !== 'unpaid') {
    return Math.min(
      Math.max(walletColumn, walletLedger) + savingsLedger,
      order.total
    );
  }
  return Math.max(
    order.amount_paid ?? 0,
    walletColumn + savingsLedger,
    walletLedger + savingsLedger,
    0
  );
}

export function getOxygenOrderNetPayable(
  order: Pick<
    z.infer<typeof oxygenCheckoutOrderSchema>,
    | 'total'
    | 'amount_paid'
    | 'wallet_amount_used'
    | 'wallet_ledger_used'
    | 'savings_ledger_used'
    | 'payment_status'
  >
): number {
  return Math.max(
    Number((order.total - getOxygenOrderPreGatewayPaid(order)).toFixed(2)),
    0
  );
}
