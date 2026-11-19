import { z } from 'zod';
export const experienceCatalogRowSchema = z.object({
  id: z.string(),
  merchant_id: z.string(),
  slug: z.string(),
  name: z.string(),
  price: z.coerce.number().finite().nonnegative(),
  status: z.string(),
  category: z.string().nullable().optional(),
  categories: z
    .object({ slug: z.string(), name: z.string().optional() })
    .nullable()
    .optional(),
  canonical_url: z.string().nullable().optional(),
  has_variants: z.boolean().nullable().optional(),
  product_categories: z
    .array(
      z.object({
        categories: z
          .object({ slug: z.string(), name: z.string().optional() })
          .nullable(),
      })
    )
    .default([]),
  manage_stock: z.boolean().nullable().optional(),
  stock: z.coerce.number().nullable().optional(),
  stock_quantity: z.coerce.number().nullable().optional(),
  available: z.boolean().optional(),
  images: z
    .array(
      z.union([
        z.string(),
        z.object({ url: z.string(), alt: z.string().optional() }),
      ])
    )
    .nullish()
    .transform((images) => images ?? []),
  product_variants: z
    .array(
      z.object({
        id: z.string(),
        attributes: z.record(z.string(), z.unknown()).optional(),
        stock_quantity: z.number().nullable().optional(),
        effective_policy: z.string().nullable().optional(),
        available_units: z.number().nullable().optional(),
        is_purchasable: z.boolean().nullable().optional(),
        price_override: z.coerce
          .number()
          .finite()
          .nonnegative()
          .nullable()
          .optional(),
      })
    )
    .default([]),
});
export const experienceCatalogSelectionSchema = z.strictObject({
  offset: z.number().int().min(0).max(10000).default(0),
  limit: z.number().int().min(1).max(100).default(40),
  categoryId: z.uuid().optional(),
  productId: z.uuid().optional(),
  productSlug: z
    .string()
    .regex(/^[a-z0-9-]{1,240}$/)
    .optional(),
});
export const publicExperienceCatalogSchema = z.object({
  revision: z.string().min(1).max(128),
  products: z
    .array(
      z.object({
        id: z.string().max(128),
        slug: z.string().max(240),
        name: z.string().max(500),
        price: z.number().finite().nonnegative(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        canonicalPath: z.string().max(1024).optional(),
        available: z.boolean().optional(),
        requiresVariant: z.boolean().optional(),
        image: z
          .object({
            assetId: z.string().regex(/^[a-z0-9-]{1,80}$/),
            alt: z.string().max(500),
          })
          .nullable(),
        variants: z
          .array(
            z.object({
              id: z.string().max(128),
              label: z.string().max(500),
              available: z.boolean(),
              price: z.number().finite().nonnegative().optional(),
            })
          )
          .max(500),
      })
    )
    .max(100),
});
