import { z } from 'zod';

const condition = z.enum(['new', 'used', 'open_box', 'refurbished']);
const boundedString = z.string().max(2048);
const currency = z
  .object({
    code: z.string().regex(/^[A-Z]{3}$/),
    locale: z.string().max(64),
    symbol: z.string().max(32),
  })
  .strict();
const variantAttributes = z
  .record(z.string().max(100), z.string().max(200))
  .refine((attributes) => Object.keys(attributes).length <= 10);
const variant = z
  .object({
    id: boundedString,
    product_id: boundedString,
    merchant_id: boundedString,
    attributes: variantAttributes,
    condition: condition.optional(),
    price_override: z.number().finite().nonnegative().optional(),
    stock_quantity: z.number().finite(),
    inventory_tracking_policy: boundedString.nullable().optional(),
    effective_policy: boundedString.nullable().optional(),
    available_units: z.number().nullable().optional(),
    images: z.array(boundedString).max(100).optional(),
    primary_image: boundedString.optional(),
  })
  .strict();
const offer = z
  .object({
    id: boundedString,
    condition,
    price: z.number().finite().nonnegative(),
    stock_quantity: z.number().finite(),
    images: z.array(boundedString).max(100).optional(),
  })
  .strict();
export const chatProductResponseSchema = z
  .object({
    product: z
      .object({
        id: boundedString,
        merchant_id: boundedString.optional(),
        name: boundedString,
        description: boundedString,
        status: z.literal('active'),
        slug: boundedString.optional(),
        price: z.number().finite().nonnegative(),
        currency,
        compare_at_price: z.number().finite().nonnegative().optional(),
        manage_stock: z.boolean(),
        stock: z.number().finite(),
        stock_quantity: z.number().finite().nullable().optional(),
        inventory_tracking_policy: boundedString.nullable().optional(),
        effective_policy: boundedString.nullable().optional(),
        image: boundedString,
        imageLarge: boundedString,
        imageHint: boundedString,
        brand: boundedString,
        gtin: boundedString,
        mpn: boundedString,
        category: boundedString.optional(),
        category_slug: boundedString.optional(),
        has_variants: z.boolean().optional(),
        variant_model: z.enum(['legacy', 'sku_matrix']).optional(),
        default_variant_id: boundedString.optional(),
        condition: condition.optional(),
        available_conditions: z.array(condition).max(20).optional(),
        has_condition_offers: z.boolean().optional(),
        offers: z.array(offer).max(128).optional(),
        variants: z.array(variant).max(128).optional(),
      })
      .strict(),
  })
  .strict();
