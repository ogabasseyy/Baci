import { z } from 'zod';

export const SavingsInterestActivitySchema = z.strictObject({
  id: z.string().min(1),
  goal_id: z.uuid(),
  amount: z
    .number()
    .finite()
    .min(-Number.MAX_SAFE_INTEGER / 100)
    .max(Number.MAX_SAFE_INTEGER / 100),
  type: z.enum(['credit', 'adjustment']),
  description: z.string(),
  source_type: z.literal('savings_interest'),
  created_at: z.iso.datetime({ offset: true }),
});
