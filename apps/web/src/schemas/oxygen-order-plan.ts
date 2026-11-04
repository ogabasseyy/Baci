import { z } from 'zod';
export const oxygenOrderPlanSchema = z.object({
  upfront: z.number().finite().nonnegative().nullable(),
  upfrontConfirmed: z.boolean(),
  activationConfirmed: z.boolean().default(false),
  months: z.number().int().positive(),
  schedule: z.array(
    z.object({
      period: z.number().int().positive(),
      dueDate: z.tuple([
        z.number().int(),
        z.number().int().min(1).max(12),
        z.number().int().min(1).max(31),
      ]),
      amount: z.number().finite().nonnegative(),
    })
  ),
});
export type OxygenOrderPlan = z.infer<typeof oxygenOrderPlanSchema>;
