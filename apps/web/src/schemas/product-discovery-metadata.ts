import { z } from 'zod';

const text = z.string().trim().min(1).max(100);
const numericAttributeKeys = new Set([
  'storage_gb',
  'ram_gb',
  'power_w',
  'screen_inches',
  'refresh_hz',
]);
const textAttributeKeys = new Set([
  'color',
  'connector',
  'processor',
  'connectivity',
]);
const attributes = z
  .record(
    z.string().regex(/^[a-z][a-z0-9_]{0,49}$/),
    z.union([text, z.number().finite().nonnegative()])
  )
  .superRefine((values, context) => {
    for (const [key, value] of Object.entries(values)) {
      if (numericAttributeKeys.has(key) && typeof value !== 'number') {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Known numeric attributes require a numeric value',
        });
      } else if (textAttributeKeys.has(key) && typeof value !== 'string') {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Known text attributes require a string value',
        });
      }
    }
  })
  .refine((value) => Object.keys(value).length <= 50, 'Too many attributes');

function canonicalProductType(value: string) {
  const normalized = value.toLocaleLowerCase('en-US').replace(/[\s-]+/g, '_');
  if (['phone', 'phones', 'smartphone', 'smartphones'].includes(normalized)) {
    return 'phone';
  }
  if (['laptop', 'laptops'].includes(normalized)) return 'laptop';
  if (['tablet', 'tablets'].includes(normalized)) return 'tablet';
  return normalized;
}

export const productDiscoveryMetadataSchema = z.strictObject({
  product_type: text.transform(canonicalProductType).optional(),
  model: text.optional(),
  compatible_with: z.array(text).max(50).optional(),
  attributes: attributes.optional(),
});
