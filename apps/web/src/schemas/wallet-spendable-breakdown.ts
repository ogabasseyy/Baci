import { z } from 'zod';

// Postgres numeric arrives as a number or a decimal string. Null, empty and
// non-numeric values must fail closed rather than coerce to 0.
const moneySchema = z.union([
  z.number().finite().nonnegative(),
  z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .transform(Number),
]);

/** Rows from public.get_merchant_wallet_spendable_breakdown (0 or 1 row). */
export const walletSpendableBreakdownRowsSchema = z.array(
  z.object({
    spendable_balance: moneySchema,
    settled_to_bank_total: moneySchema,
    pending_reconciliation_total: moneySchema,
  })
);
