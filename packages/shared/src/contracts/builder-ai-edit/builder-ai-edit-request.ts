import { z } from 'zod';
import { builderDataSchema } from './builder-data';
import { BUILDER_AI_EDIT_CONTRACT_VERSION } from './limits';

export const builderAiEditRequestSchema = z.strictObject({
  clientRequestId: z.uuid(),
  contractVersion: z.literal(BUILDER_AI_EDIT_CONTRACT_VERSION),
  currentConfig: builderDataSchema,
  merchantId: z.uuid(),
  prompt: z.string().trim().min(1).max(1000),
});

export type BuilderAiEditRequest = z.infer<typeof builderAiEditRequestSchema>;
