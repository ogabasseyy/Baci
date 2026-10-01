import { z } from 'zod';
import { builderDataSchema } from './builder-data';
import {
  BUILDER_AI_EDIT_CONTRACT_VERSION,
  MAX_AI_PLAN_INSERTS,
  MAX_AI_PLAN_OPERATIONS,
} from './limits';
import { builderAiModelOperationSchema } from './model-plan-operation';

export const builderAiEditCandidateSchema = z
  .strictObject({
    candidateConfig: builderDataSchema,
    clientRequestId: z.uuid(),
    contractVersion: z.literal(BUILDER_AI_EDIT_CONTRACT_VERSION),
    operations: z
      .array(builderAiModelOperationSchema)
      .max(MAX_AI_PLAN_OPERATIONS),
    summary: z.string().trim().min(1).max(240),
    warnings: z.array(z.string().max(160)).max(10),
  })
  .refine(
    (value) =>
      value.operations.filter(
        (operation) => operation.kind === 'insert_component'
      ).length <= MAX_AI_PLAN_INSERTS,
    'Candidate has too many inserts'
  );

export type BuilderAiEditCandidate = z.infer<
  typeof builderAiEditCandidateSchema
>;
