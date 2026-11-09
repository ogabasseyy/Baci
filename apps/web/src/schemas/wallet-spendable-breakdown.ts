import { z } from 'zod';

/** Rows from public.get_merchant_wallet_spendable_breakdown (0 or 1 row). */
export const walletSpendableBreakdownRowsSchema = z.array(
  z.object({
    spendable_balance: z.coerce.number().finite(),
    settled_to_bank_total: z.coerce.number().finite(),
  })
);
