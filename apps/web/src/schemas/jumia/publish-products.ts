import { z } from 'zod';

export const MAX_PRODUCT_PAGES = 50;

export const publishProductSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  sku: z.string().nullable().optional(),
  price: z.number(),
  stock: z.number().optional(),
  image: z.string().optional(),
  images: z
    .array(
      z.union([
        z.string(),
        z.object({
          url: z.string().optional(),
        }),
      ])
    )
    .optional(),
  variants: z
    .array(
      z.object({
        id: z.string().trim().min(1).optional(),
        sku: z.string().nullable().optional(),
        price_override: z.number().nullable().optional(),
        stock_quantity: z.number().optional(),
        is_inventory_anchor: z.boolean().optional(),
      })
    )
    .optional(),
});

export const publishProductsPageSchema = z.object({
  products: z.array(publishProductSchema).default([]),
  pagination: z
    .object({
      totalPages: z.number().finite().nonnegative().optional(),
    })
    .optional(),
});

export type PublishProduct = z.infer<typeof publishProductSchema>;
