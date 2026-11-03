import z from 'zod';

export const fastCatalogProductRowSchema = z
  .object({
    id: z.string().min(1),
    merchant_id: z.string().min(1),
    category_id: z.string().nullable(),
    name: z.string().min(1),
    brand: z.string().nullable(),
    category: z.string().nullable(),
    description: z.string().nullable(),
    images: z.unknown(),
    price: z.number().finite(),
    slug: z.string().nullable().optional(),
    status: z.string().nullable(),
    stock: z.number().nullable(),
    stock_quantity: z.number().nullable().optional(),
    manage_stock: z.boolean().nullable(),
    has_variants: z.boolean().nullable(),
    has_condition_offers: z.boolean().nullable(),
    available_conditions: z.array(z.unknown()).nullable().optional(),
    variant_model: z.string().nullable(),
    condition: z.string().nullable().optional(),
    product_key_specs: z.unknown().optional(),
  })
  .passthrough();

export const fastCatalogVariantRowSchema = z
  .object({
    id: z.string().min(1),
    product_id: z.string().min(1),
    attributes: z.record(z.string(), z.unknown()).nullable().optional(),
    price_override: z
      .union([z.number().finite(), z.string()])
      .nullable()
      .optional(),
    stock_quantity: z.number().finite().nullable().optional(),
    available_units: z.number().finite().nullable().optional(),
    effective_policy: z.string().nullable().optional(),
    condition: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    is_active: z.boolean().nullable().optional(),
    is_inventory_anchor: z.boolean().nullable().optional(),
    archived_at: z.string().nullable().optional(),
    deleted_at: z.string().nullable().optional(),
  })
  .passthrough();
