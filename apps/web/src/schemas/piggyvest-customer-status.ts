import { z } from 'zod';
import { piggyvestSavingsViewSchemas } from './piggyvest-savings-view';

export const piggyvestCustomerStatusSchema = z
  .strictObject({
    goal: piggyvestSavingsViewSchemas.goal,
    device: z.strictObject({
      productName: z.string().trim().min(1).max(200),
      variant: z.string().trim().min(1).max(200).nullable(),
      condition: z.string().trim().min(1).max(100),
    }),
  })
  .refine(
    (input) =>
      (input.device.variant === null) ===
      (input.goal.policy.device.variantId === null)
  );
