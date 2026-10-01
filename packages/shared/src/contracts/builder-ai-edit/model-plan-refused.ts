import { z } from 'zod';
import { MAX_AI_PLAN_SUMMARY_OR_REFUSAL_REASON_CHARS } from './limits';

export const builderAiRefusedPlanSchema = z.strictObject({
  operations: z.tuple([]),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(MAX_AI_PLAN_SUMMARY_OR_REFUSAL_REASON_CHARS),
  status: z.literal('refused'),
});
