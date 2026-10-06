import { z } from 'zod';
import { piggyvestGoalLifecycleSchemas } from './piggyvest-goal-lifecycle';

const uuid = z.uuid().transform((value) => value.toLowerCase());
export const piggyvestCustomerLifecycleHandlerSchemas = {
  terms: z.strictObject({
    goalId: uuid,
    revisionId: uuid,
    durationMonths: z.number().int().min(1).max(6),
  }),
  activate: piggyvestGoalLifecycleSchemas.input.shape.command.extend({
    goalId: uuid,
  }),
  boundActivation: piggyvestGoalLifecycleSchemas.input
    .omit({ database: true })
    .extend({ transport: z.literal('local_test') }),
  boundTerms: piggyvestGoalLifecycleSchemas.termsInput
    .omit({ database: true })
    .extend({ transport: z.literal('local_test') }),
};
