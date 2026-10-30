import { z } from 'zod';

export const SavingsInterestActivitySchema = z.strictObject({
  id: z.string().min(1),
  goal_id: z.uuid(),
  // Preserve the activity row when its amount cannot be represented safely in
  // the wallet's currency type. The UI renders null as explicitly unavailable.
  amount: z
    .number()
    .finite()
    .transform((amount) =>
      Math.abs(amount) <= Number.MAX_SAFE_INTEGER / 100 ? amount : null
    ),
  type: z.enum(['credit', 'adjustment']),
  description: z.string(),
  date_basis: z.enum(['ledger', 'received', 'observed', 'unknown']).optional(),
  source_type: z.literal('savings_interest'),
  created_at: z.iso.datetime({ offset: true }).nullable(),
});
