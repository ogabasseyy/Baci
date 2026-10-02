import { z } from 'zod';
import { productDiscoveryMetadataSchema } from './product-discovery-metadata';

export const updateProductDiscoveryMetadataSchema = z.strictObject({
  productId: z.uuid(),
  metadata: productDiscoveryMetadataSchema,
});
