import { z } from 'zod';
import {
  MAX_AI_PLAN_OPERATIONS,
  MAX_AI_PLAN_SUMMARY_OR_REFUSAL_REASON_CHARS,
} from './limits';
import {
  type BuilderAiModelOperation,
  builderAiModelOperationSchema,
} from './model-plan-operation';

export const builderAiProposedPlanSchema = z.strictObject({
  operations: z
    .array(builderAiModelOperationSchema)
    .min(1)
    .max(MAX_AI_PLAN_OPERATIONS),
  status: z.literal('proposed'),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(MAX_AI_PLAN_SUMMARY_OR_REFUSAL_REASON_CHARS),
});

export type BuilderAiProposedPlan = {
  operations: BuilderAiModelOperation[];
  status: 'proposed';
  summary: string;
};
