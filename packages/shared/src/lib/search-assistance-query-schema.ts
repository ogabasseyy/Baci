import { z } from 'zod';
import { buildProductSearchQuery } from './product-search';

// Single source for the assistance query rule (trimmed 2–120 chars plus a
// catalog term): the request schema, the proposal schema, and both
// storefront gates validate against this field so the advertised action
// can never promise a request the API would reject.
export const searchAssistanceQuerySchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .refine((value) => Boolean(buildProductSearchQuery(value).normalized));
