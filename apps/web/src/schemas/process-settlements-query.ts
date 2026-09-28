import { z } from 'zod';

export const processSettlementsQuerySchema = z.object({
  cancellationsOnly: z.enum(['true', 'false']).optional(),
});

export type ProcessSettlementsQuery = z.infer<
  typeof processSettlementsQuerySchema
>;
