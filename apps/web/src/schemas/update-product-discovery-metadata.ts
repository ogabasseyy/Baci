import { z } from 'zod';
import { productDiscoveryMetadataSchema } from './product-discovery-metadata';

const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const updateProductDiscoveryMetadataSchema = z.strictObject({
  productId: z.uuid(),
  merchantId: z.uuid().optional(),
  metadata: productDiscoveryMetadataSchema,
  // Opaque database-computed SHA-256 covers both facts and their research source.
  expectedRevision: revisionSchema,
});

export const discoveryFactsQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  merchantId: z.uuid().optional(),
});

export const discoveryResearchPageSchema = z
  .array(
    z.object({
      product: z.object({
        id: z.uuid(),
        name: z.string(),
        category: z.string().nullable(),
        metadata: z.unknown(),
        discovery_metadata: z.unknown(),
        specifications: z.unknown(),
        mpn: z.string().nullable(),
        color: z.string().nullable(),
      }),
      revision: revisionSchema,
    })
  )
  .max(21);
