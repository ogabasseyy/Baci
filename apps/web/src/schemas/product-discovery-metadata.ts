import { z } from 'zod';
import { canonicalizeDiscoveryProductType } from './canonical-discovery-product-type';

const maxDiscoveryMetadataBytes = 16_384;

const text = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (value) => !value.includes('\u0000'),
    'Null characters cannot be stored'
  );
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

/** PostgreSQL jsonb text includes separator spaces and expands exponent numbers. */
function jsonbText(value: unknown): string {
  if (typeof value === 'number') {
    const serialized = JSON.stringify(value);
    const match = serialized.match(/^(\d+)(?:\.(\d+))?e([+-]?\d+)$/i);
    if (!match) return serialized;
    const digits = match[1] + (match[2] ?? '');
    const decimalPosition = match[1].length + Number(match[3]);
    if (decimalPosition <= 0)
      return `0.${'0'.repeat(-decimalPosition)}${digits}`;
    if (decimalPosition >= digits.length)
      return digits + '0'.repeat(decimalPosition - digits.length);
    return `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  }
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => `${JSON.stringify(key)}: ${jsonbText(entry)}`)
      .join(', ')}}`;
  }
  return JSON.stringify(value);
}

export const productDiscoveryMetadataSchema = z
  .strictObject({
    product_type: text.transform(canonicalizeDiscoveryProductType).optional(),
    model: text.optional(),
    compatible_with: z.array(text).max(50).optional(),
    attributes: attributes.optional(),
  })
  .superRefine((metadata, context) => {
    const serialized = jsonbText(metadata);
    if (
      new TextEncoder().encode(serialized).byteLength >
      maxDiscoveryMetadataBytes
    ) {
      context.addIssue({
        code: 'custom',
        message: `Discovery metadata must be at most ${maxDiscoveryMetadataBytes} UTF-8 bytes`,
      });
    }
  });
