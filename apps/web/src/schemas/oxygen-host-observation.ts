import { z } from 'zod';

export const oxygenHostObservationQuery = z.object({
  workflowId: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase()),
  commandId: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase()),
});
