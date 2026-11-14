import { z } from 'zod';

const item = z.strictObject({
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
  amountKobo: z.number().int().positive(),
  /** PiggyVest's deposit fee (0 for other movements). */
  feeKobo: z.number().int().nonnegative(),
  // Goal titles are not length-bounded where they are created: shorten for
  // display instead of failing the whole page (the server does the same).
  label: z
    .string()
    .min(1)
    .transform((value) => value.slice(0, 600)),
  status: z.enum(['completed', 'pending']),
  occurredAt: z.iso.datetime({ offset: true }),
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
