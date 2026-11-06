import { z } from 'zod';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';

const merchantSlug = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/);
const productSlug = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => evaluateStorefrontSlugSafety(value).safe);
export const chatProductRouteParamsSchema = z
  .object({ slug: merchantSlug, productSlug })
  .strict();
