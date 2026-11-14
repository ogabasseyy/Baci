import { z } from 'zod';

const item = z.strictObject({
  id: z.uuid(),
  // Any well-formed kind: a row is drawn from its direction, label and
  // status alone, so a kind added on the server later (today: bank_transfer,
  // card_funding, savings_contribution, goal_refund, goal_completed,
  // wallet_spend, wallet_refund) still shows instead of failing the whole
  // page in an older app (Muse).
  kind: z.string().regex(/^[a-z][a-z_]{0,39}$/),
  direction: z.enum(['in', 'out']),
  /** What reached the wallet: deposits are net of PiggyVest's fee. */
  amountKobo: z.number().int().positive(),
  /** PiggyVest's deposit fee (0 for other movements). */
  feeKobo: z.number().int().nonnegative(),
  label: z.string().min(1).max(600),
  status: z.enum(['completed', 'pending']),
  occurredAt: z.string().min(1),
});

/** One page of GET /api/storefront/customer/wallet/piggyvest-activity. */
export const piggyvestWalletActivityPageSchema = z.strictObject({
  items: z.array(item).max(50),
  nextCursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,200}$/)
    .nullable(),
});

export type PiggyvestWalletActivityPage = z.infer<
  typeof piggyvestWalletActivityPageSchema
>;
export type PiggyvestWalletActivityItem =
  PiggyvestWalletActivityPage['items'][number];
