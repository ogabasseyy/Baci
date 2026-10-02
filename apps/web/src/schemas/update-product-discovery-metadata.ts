import { z } from 'zod';
import { productDiscoveryMetadataSchema } from './product-discovery-metadata';

// Inspect depth iteratively before z.json() recursively validates untrusted JSON.
function hasBoundedSnapshotDepth(value: unknown): boolean {
  const pending = [{ value, depth: 0 }];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) break;
    if (entry.depth > 32) return false;
    if (entry.value !== null && typeof entry.value === 'object') {
      for (const child of Object.values(entry.value)) {
        pending.push({ value: child, depth: entry.depth + 1 });
      }
    }
  }
  return true;
}

export const updateProductDiscoveryMetadataSchema = z.strictObject({
  productId: z.uuid(),
  merchantId: z.uuid().optional(),
  metadata: productDiscoveryMetadataSchema,
  expectedMetadata: z
    .unknown()
    .refine(
      hasBoundedSnapshotDepth,
      'Snapshot nesting exceeds the supported depth'
    )
    .pipe(z.union([z.null(), z.record(z.string(), z.json())]))
    .refine(
      (value) =>
        new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65536,
      'Snapshot too large'
    ),
});

export const discoveryFactsQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  merchantId: z.uuid().optional(),
});
