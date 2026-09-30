import { z } from 'zod';
import { canonicalizeDiscoveryProductType } from './canonical-discovery-product-type';

const text = z.string().trim().min(1).max(100);
const attribute = z
  .strictObject({
    key: z.enum([
      'storage_gb',
      'ram_gb',
      'power_w',
      'screen_inches',
      'refresh_hz',
      'color',
      'connector',
      'processor',
      'connectivity',
    ]),
    operator: z.enum(['eq', 'gte', 'lte']),
    value: z.union([text, z.number().finite().nonnegative()]),
  })
  .superRefine((value, context) => {
    const numeric = [
      'storage_gb',
      'ram_gb',
      'power_w',
      'screen_inches',
      'refresh_hz',
    ].includes(value.key);
    if (
      numeric !== (typeof value.value === 'number') ||
      (!numeric && value.operator !== 'eq')
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Use numeric values for numeric specifications and equality for text attributes',
      });
    }
  });

export const mcpDiscoveryIntentSchema = z.strictObject({
  alternatives: z
    .array(
      z.strictObject({
        product_type: text
          .transform(canonicalizeDiscoveryProductType)
          .optional(),
        brands: z.array(text).min(1).max(10).optional(),
        model: text.optional(),
        compatible_with: text.optional(),
        attributes: z.array(attribute).max(10).optional(),
      })
    )
    .min(1)
    .max(5),
  excluded_product_types: z
    .array(text.transform(canonicalizeDiscoveryProductType))
    .max(10)
    .optional(),
});

export type McpDiscoveryIntent = z.infer<typeof mcpDiscoveryIntentSchema>;
