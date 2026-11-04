import { z } from 'zod';
import { oxygenWorkflowStageSchema } from './oxygen-workflow';

/** Structured commands only: raw messages and identity details never enter chat. */
export const oxygenChatRequestSchema = z
  .object({
    orderId: z.uuid(),
    messageId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
    channel: z.enum(['webchat', 'whatsapp']),
    intent: z.enum(['resume', 'status']),
  })
  .strict();
export type OxygenChatRequest = z.infer<typeof oxygenChatRequestSchema>;

export const oxygenChatResponseSchema = z
  .object({
    messageId: oxygenChatRequestSchema.shape.messageId,
    channel: oxygenChatRequestSchema.shape.channel,
    application: z
      .object({
        workflowId: z.uuid(),
        stage: oxygenWorkflowStageSchema,
        version: z.number().int().nonnegative(),
      })
      .strict(),
    prompt: z.string(),
    actions: z
      .array(
        z
          .object({
            type: z.literal('secure_handoff'),
            label: z.literal('Continue securely'),
            path: z.string().regex(/^\/payments\/oxygen\/[0-9a-f-]{36}$/),
          })
          .strict()
      )
      .max(1),
    activationEnabled: z.literal(false),
    settlementEnabled: z.literal(false),
  })
  .strict();
export type OxygenChatResponse = z.infer<typeof oxygenChatResponseSchema>;
