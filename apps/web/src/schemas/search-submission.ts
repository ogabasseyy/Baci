import { z } from 'zod';
import { sanitizeSearchQuery } from '@/lib/sanitize-core';

export const searchSubmissionSchema = z.strictObject({
  query: z
    .string()
    .max(100)
    .transform(sanitizeSearchQuery)
    .pipe(z.string().min(1)),
  pathPrefix: z
    .string()
    .max(64)
    .regex(/^(\/[a-z0-9][a-z0-9-]*)?$/),
  source: z.enum(['navbar', 'results-form', 'see-all', 'did-you-mean']),
});
