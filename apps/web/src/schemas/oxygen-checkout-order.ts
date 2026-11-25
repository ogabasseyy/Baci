import {
  computeOrderNetPayable,
  computeOrderPreGatewayPaid,
  isPreGatewayCreditStatus,
} from '@baci/shared/lib';
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
  wallet_reversal_completed: z.boolean().optional(),
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

export const isOxygenPreGatewayStatus = isPreGatewayCreditStatus;

type OxygenOrderCreditFields = Pick<
  z.infer<typeof oxygenCheckoutOrderSchema>,
  | 'total'
  | 'amount_paid'
  | 'wallet_amount_used'
  | 'wallet_ledger_used'
  | 'savings_ledger_used'
  | 'wallet_reversal_completed'
  | 'payment_status'
>;

export function getOxygenOrderPreGatewayPaid(
  order: OxygenOrderCreditFields
): number {
  return computeOrderPreGatewayPaid({
    total: order.total,
    amountPaid: order.amount_paid,
    walletAmountUsed: order.wallet_amount_used,
    walletLedgerUsed: order.wallet_ledger_used,
    savingsLedgerUsed: order.savings_ledger_used,
    paymentStatus: order.payment_status,
    walletReversalCompleted: order.wallet_reversal_completed,
  });
}

export function getOxygenOrderNetPayable(
  order: OxygenOrderCreditFields
): number {
  return computeOrderNetPayable({
    total: order.total,
    amountPaid: order.amount_paid,
    walletAmountUsed: order.wallet_amount_used,
    walletLedgerUsed: order.wallet_ledger_used,
    savingsLedgerUsed: order.savings_ledger_used,
    paymentStatus: order.payment_status,
    walletReversalCompleted: order.wallet_reversal_completed,
  });
}
