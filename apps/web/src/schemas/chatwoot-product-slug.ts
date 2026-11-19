import { z } from 'zod';

/**
 * Catalog slugs may be up to 200 characters and contain dots (see
 * `schemas/products.ts`). Segments are joined by single hyphens and may not
 * contain path-traversal dots.
 */
export const chatwootProductSlugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_.]+(?:-[a-zA-Z0-9_.]+)*$/)
  .refine((value) => !value.includes('..'));
