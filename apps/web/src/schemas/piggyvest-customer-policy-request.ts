import { z } from 'zod';
import { piggyvestGoalPolicySchemas } from './piggyvest-goal-policy';

const command = piggyvestGoalPolicySchemas.command.shape;

export const piggyvestCustomerPolicyRequestSchemas = {
  read: z.strictObject({
    goalId: piggyvestGoalPolicySchemas.configuration.shape.goalId,
  }),
  accept: z.strictObject({
    goalId: piggyvestGoalPolicySchemas.configuration.shape.goalId,
    revisionId: command.revisionId,
    termsVersion: command.termsVersion,
    termsHash: command.termsHash,
    accepted: z.literal(true),
    durationMonths: piggyvestGoalPolicySchemas.acceptance.shape.durationMonths,
  }),
  terms: z.strictObject({
    version: command.termsVersion,
    hash: command.termsHash,
    text: z
      .string()
      .min(1)
      .max(32_768)
      .refine(
        (text) =>
          text.trim().length > 0 &&
          text.isWellFormed() &&
          new TextEncoder().encode(text).byteLength <= 32_768
      ),
  }),
};
