import { z } from 'zod';

/** GET /api/storefront/customer/wallet/piggyvest-activity query string. */
export const piggyvestWalletActivityQuerySchema = z.strictObject({
  merchantId: z.uuid(),
  /** Opaque cursor from the previous page's `nextCursor`. */
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,200}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** One row as public.list_piggyvest_wallet_activity returns it. */
export const piggyvestWalletActivityRowSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum([
    'bank_transfer',
    'card_funding',
    'savings_contribution',
    'goal_refund',
    'goal_completed',
  ]),
  direction: z.enum(['in', 'out']),
  /** What reached the wallet: deposits are net of PiggyVest's fee. */
  amount_kobo: z.number().int().positive(),
  /** PiggyVest's deposit fee; 0 for every other movement. */
  fee_kobo: z.number().int().nonnegative(),
  label: z.string().min(1).max(600),
  status: z.enum(['completed', 'pending']),
  occurred_at: z.iso.datetime({ offset: true }),
});

export type PiggyvestWalletActivityRow = z.infer<
  typeof piggyvestWalletActivityRowSchema
>;
