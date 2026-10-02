import { z } from 'zod';
import { productDiscoveryMetadataSchema } from './product-discovery-metadata';

const invalidPostgresString =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

// Validate depth and PostgreSQL string representability before recursive z.json().
function isSafeSnapshot(value: unknown): boolean {
  const pending = [{ value, depth: 0 }];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) break;
    if (entry.depth > 32) return false;
    if (
      typeof entry.value === 'string' &&
      (entry.value.includes('\u0000') ||
        invalidPostgresString.test(entry.value))
    )
      return false;
    if (entry.value !== null && typeof entry.value === 'object') {
      for (const [key, child] of Object.entries(entry.value)) {
        if (key.includes('\u0000') || invalidPostgresString.test(key))
          return false;
        pending.push({ value: child, depth: entry.depth + 1 });
      }
    }
  }
  return true;
}

const snapshotSchema = z
  .unknown()
  .refine(
    isSafeSnapshot,
    'Snapshot exceeds supported depth or contains invalid strings'
  )
  .pipe(z.union([z.null(), z.record(z.string(), z.json())]))
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65536,
    'Snapshot too large'
  );

const sourceKeys = [
  'name',
  'category',
  'metadata',
  'specifications',
  'mpn',
  'color',
] as const;
export const discoverySourceSnapshotSchema = snapshotSchema.refine(
  (value) =>
    value !== null &&
    Object.keys(value).length === sourceKeys.length &&
    sourceKeys.every((key) => Object.hasOwn(value, key)),
  'Complete source snapshot required'
);

export const updateProductDiscoveryMetadataSchema = z.strictObject({
  productId: z.uuid(),
  merchantId: z.uuid().optional(),
  metadata: productDiscoveryMetadataSchema,
  expectedMetadata: snapshotSchema,
  expectedSource: discoverySourceSnapshotSchema,
});

export const discoveryFactsQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  merchantId: z.uuid().optional(),
});
