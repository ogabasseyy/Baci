import { z } from 'zod';
import { canonicalizeDiscoveryProductType } from './canonical-discovery-product-type';

// Draft-07 maxLength counts Unicode code points while z.string().max counts
// UTF-16 units, so the runtime measures code points: it accepts exactly what
// the published card schema advertises, including 100 astral characters. The
// 200-unit prefilter is equivalent (100 code points need at most 200 units)
// and keeps pathological input out of Array.from.
const text = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.length <= 200 && Array.from(value).length <= 100, {
    message: 'Text must contain at most 100 characters',
  });
// Retrieval expands numerics to plain decimals inside a 16,000-char gated
// tsquery: unbounded magnitudes (Number.MAX_VALUE is 309 digits) would let a
// schema-valid intent silently exceed the gate and return no rows. Bounds
// keep every representable intent retrievable; zero stays allowed.
const MAX_DISCOVERY_NUMERIC_VALUE = 1_000_000_000;
const MIN_DISCOVERY_NUMERIC_VALUE = 1e-6;
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
    if (
      typeof value.value === 'number' &&
      value.value !== 0 &&
      !(
        value.value >= MIN_DISCOVERY_NUMERIC_VALUE &&
        value.value <= MAX_DISCOVERY_NUMERIC_VALUE
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Numeric specifications must use realistic magnitudes',
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
    .max(5)
    .superRefine((alternatives, context) => {
      if (
        alternatives.length > 1 &&
        alternatives.some(
          ({ product_type, brands, model, compatible_with, attributes }) =>
            !(
              product_type ||
              brands?.length ||
              model ||
              compatible_with ||
              attributes?.length
            )
        )
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'An unconstrained browse alternative must be the only alternative',
        });
      }
    }),
  excluded_product_types: z
    .array(text.transform(canonicalizeDiscoveryProductType))
    .max(10)
    .optional(),
});

export type McpDiscoveryIntent = z.infer<typeof mcpDiscoveryIntentSchema>;
