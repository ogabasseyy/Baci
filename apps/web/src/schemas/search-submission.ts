import { z } from 'zod';
import { sanitizeSearchQuery } from '@/lib/sanitize-core';
import {
  SEARCH_SUBMISSION_QUERY_MAX_LENGTH,
  SEARCH_SUBMISSION_SOURCES,
} from '@/lib/search-submission';

export const searchSubmissionSchema = z.strictObject({
  query: z
    .string()
    .max(SEARCH_SUBMISSION_QUERY_MAX_LENGTH)
    .transform(sanitizeSearchQuery)
    .pipe(z.string().min(1)),
  pathPrefix: z
    .string()
    .max(64)
    .regex(/^(\/[a-z0-9][a-z0-9-]*)?$/),
  source: z.enum(SEARCH_SUBMISSION_SOURCES),
});
