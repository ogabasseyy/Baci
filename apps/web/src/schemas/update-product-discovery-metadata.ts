import { z } from 'zod';
import { productDiscoveryMetadataSchema } from './product-discovery-metadata';

export const updateProductDiscoveryMetadataSchema = z.strictObject({
  productId: z.uuid(),
  merchantId: z.uuid().optional(),
  metadata: productDiscoveryMetadataSchema,
  expectedMetadata: z
    .union([z.null(), z.record(z.string(), z.json())])
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
