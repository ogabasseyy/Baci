import { z } from 'zod';
export const oxygenSelfieStatusRequestSchema = z
  .object({ workflowId: z.uuid() })
  .strict();
export const oxygenSelfieStatusSchema = z
  .object({ confirmed: z.boolean(), checkedAt: z.iso.datetime() })
  .strict();
