import { z } from 'zod';

const text = z.string().trim().min(1).max(100);
export const productDiscoveryMetadataSchema = z.strictObject({
  product_type: text.optional(),
  model: text.optional(),
  compatible_with: z.array(text).max(50).optional(),
  attributes: z
    .record(
      z.string().regex(/^[a-z][a-z0-9_]{0,49}$/),
      z.union([text, z.number().finite().nonnegative()])
    )
    .refine((value) => Object.keys(value).length <= 50, 'Too many attributes')
    .optional(),
});
