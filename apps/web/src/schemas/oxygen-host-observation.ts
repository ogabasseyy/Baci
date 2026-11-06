import { z } from 'zod';

export const oxygenHostObservationQuery = z.object({
  workflowId: z.string().uuid(),
  commandId: z.string().uuid(),
});
