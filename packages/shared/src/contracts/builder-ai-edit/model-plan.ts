import { z } from 'zod';
import {
  MAX_AI_PLAN_INSERTS,
  MAX_AI_PLAN_SERIALIZED_UTF8_BYTES,
} from './limits';
import { builderAiProposedPlanSchema } from './model-plan-proposed';
import { builderAiRefusedPlanSchema } from './model-plan-refused';

export type { BuilderAiModelOperation } from './model-plan-operation';
export { builderAiModelOperationSchema } from './model-plan-operation';
export type { BuilderAiProposedPlan } from './model-plan-proposed';
export { builderAiProposedPlanSchema } from './model-plan-proposed';
export { builderAiRefusedPlanSchema } from './model-plan-refused';

export const builderAiModelPlanSchema = z
  .discriminatedUnion('status', [
    builderAiProposedPlanSchema,
    builderAiRefusedPlanSchema,
  ])
  .refine(
    (plan) =>
      plan.operations.filter(
        (operation) => operation.kind === 'insert_component'
      ).length <= MAX_AI_PLAN_INSERTS,
    'Plan has too many inserts'
  )
  .refine(
    (plan) =>
      new TextEncoder().encode(JSON.stringify(plan)).byteLength <=
      MAX_AI_PLAN_SERIALIZED_UTF8_BYTES,
    'Plan is too large'
  );

export type BuilderAiEditPlan = z.infer<typeof builderAiModelPlanSchema>;
