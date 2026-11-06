import { z } from 'zod';

export const oxygenHostObservationQuery = z.object({
  workflowId: z.uuid(),
  commandId: z.uuid(),
});
