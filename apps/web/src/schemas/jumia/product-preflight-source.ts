import { z } from 'zod';

/** Exact v1 projection returned by `jumia_product_export_source_projection_v1`. */
export const jumiaCanonicalProductProjectionSchema = z
  .object({
    contractVersion: z.literal(1),
    product: z
      .object({
        id: z.uuid(),
        merchantId: z.uuid(),
        status: z.string(),
        hasVariants: z.boolean().nullable(),
        variantModel: z.string().nullable(),
        updatedAt: z.string(),
        name: z.string().nullable(),
        description: z.string().nullable(),
        sku: z.string().nullable(),
        exportImages: z.unknown(),
        price: z.number().nullable(),
        stock: z.number().nullable(),
        stockQuantity: z.number().nullable(),
        manageStock: z.boolean().nullable(),
        inventoryTrackingPolicy: z.string().nullable(),
        inventoryAnchorVariantId: z.uuid().nullable(),
        condition: z.string().nullable(),
        weightValue: z.number().nullable(),
        weightUnit: z.string().nullable(),
        categoryId: z.uuid().nullable(),
      })
      .strict(),
    categoryMemberships: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string(),
            isActive: z.boolean(),
          })
          .strict()
      )
      .max(100),
    variants: z
      .array(
        z
          .object({
            id: z.uuid(),
            attributes: z.record(z.string(), z.unknown()),
            sku: z.string().nullable(),
            priceOverride: z.number().nullable(),
            stockQuantity: z.number().nullable(),
            inventoryTrackingPolicy: z.string().nullable(),
            condition: z.string().nullable(),
            updatedAt: z.string(),
            isInventoryAnchor: z.boolean(),
          })
          .strict()
      )
      .max(500),
    images: z
      .array(
        z
          .object({
            id: z.uuid(),
            variantId: z.uuid().nullable(),
            status: z.string(),
            verifiedUrl: z.string().nullable(),
            verifiedFormat: z.string().nullable(),
            isPrimary: z.boolean(),
            position: z.number().int(),
            verifiedAt: z.string().nullable(),
            updatedAt: z.string(),
          })
          .strict()
      )
      .max(100),
  })
  .strict();

export type JumiaCanonicalProductProjection = z.infer<
  typeof jumiaCanonicalProductProjectionSchema
>;
