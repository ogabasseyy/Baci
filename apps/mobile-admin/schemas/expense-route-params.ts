import { z } from 'zod';

export const ExpenseRouteParamsSchema = z
  .object({
    id: z.preprocess(
      (value) => (Array.isArray(value) ? value[0] : value),
      z.uuid()
    ),
  })
  .strict();
