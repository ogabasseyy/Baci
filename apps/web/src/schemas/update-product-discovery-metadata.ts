import { z } from 'zod';
import { productDiscoveryMetadataSchema } from './product-discovery-metadata';

export const updateProductDiscoveryMetadataSchema = z.strictObject({
  productId: z.uuid(),
  metadata: productDiscoveryMetadataSchema,
  expectedMetadata: z
    .union([z.null(), z.record(z.string(), z.json())])
    .refine(
      (value) => JSON.stringify(value).length <= 65536,
      'Snapshot too large'
    )
    .optional(),
});
