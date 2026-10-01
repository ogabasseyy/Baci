import { z } from 'zod';

export const ADMIN_OPERATIONS_MAX_OFFSET = 10_000;

export const adminOperationsSectionSchema = z.enum([
  'all',
  'financial',
  'notifications',
  'shipping',
  'workers',
]);

export const adminOperationsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .max(ADMIN_OPERATIONS_MAX_OFFSET)
    .default(0),
  section: adminOperationsSectionSchema.default('all'),
});

export type AdminOperationsQuery = z.infer<typeof adminOperationsQuerySchema>;
