import { z } from 'zod';
export const oxygenApprovalCodeQuerySchema = z
  .object({ workflowId: z.uuid() })
  .strict();
export const oxygenApprovalCodeWindowSchema = z
  .object({
    bookingReference: z.uuid(),
    sentAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.expiresAt) - Date.parse(value.sentAt) === 300_000,
    'Invalid code window'
  );
export const oxygenApprovalCodeResponseSchema = z
  .object({ window: oxygenApprovalCodeWindowSchema.nullable() })
  .strict();
export type OxygenApprovalCodeWindow = z.infer<
  typeof oxygenApprovalCodeWindowSchema
>;
