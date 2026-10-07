import { z } from 'zod';

export const piggyvestWebhookIntakeConfigurationSchema = z
  .object({
    environment: z.literal('staging'),
    integrationId: z.uuid(),
    secret: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0),
    expectedProjectId: z.string().min(1),
    actualProjectId: z.string().min(1),
    rawByteSignatureVerified: z.literal(true),
    durableAcknowledgementApproved: z.literal(true),
  })
  .strict()
  .refine((value) => value.expectedProjectId === value.actualProjectId);
