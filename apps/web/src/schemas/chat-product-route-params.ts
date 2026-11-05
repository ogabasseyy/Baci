import { z } from 'zod';

const merchantSlug = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/);
const productSlug = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_]+(?:-[a-zA-Z0-9_]+)*$/);
export const chatProductRouteParamsSchema = z
  .object({ slug: merchantSlug, productSlug })
  .strict();
