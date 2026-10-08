import { z } from 'zod';

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : Number.NaN;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return value;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }

  return value;
}

export const NumberLikeSchema = z.preprocess(toFiniteNumber, z.number());
export const NullableNumberLikeSchema = z.preprocess(
  (value) => (value === null ? null : toFiniteNumber(value)),
  z.number().nullable()
);
export const NullableNonnegativeIntegerLikeSchema = z.preprocess(
  (value) => (value === null ? null : toFiniteNumber(value)),
  z.number().int().nonnegative().nullable()
);

export const ProductImageEntrySchema = z.union([
  z.string(),
  z
    .object({
      url: z.string().optional(),
      src: z.string().optional(),
      uri: z.string().optional(),
    })
    .refine((value) => Boolean(value.url || value.src || value.uri), {
      message: 'Expected at least one image source (url, src, or uri)',
    }),
]);

export const ProductVariantSchema = z.object({
  id: z.string(),
  product_id: z.string().optional(),
  merchant_id: z.string().optional(),
  name: z.string().optional(),
  condition: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  price: NumberLikeSchema.optional(),
  compare_at_price: NullableNumberLikeSchema.optional(),
  price_override: NullableNumberLikeSchema.optional(),
  price_modifier: NullableNumberLikeSchema.optional(),
  image: z.string().nullable().optional(),
  primary_image: z.string().nullable().optional(),
  images: z.array(ProductImageEntrySchema).nullable().optional(),
  in_stock: z.boolean().nullable().optional(),
  stock_quantity: NullableNonnegativeIntegerLikeSchema.optional(),
  effective_policy: z.string().nullable().optional(),
  available_units: NullableNonnegativeIntegerLikeSchema.optional(),
  attributes: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const ProductConditionOfferSchema = z.object({
  id: z.string(),
  condition: z.string(),
  price: NumberLikeSchema,
  compare_at_price: NullableNumberLikeSchema.optional(),
  stock_quantity: NullableNonnegativeIntegerLikeSchema.optional(),
  images: z.array(ProductImageEntrySchema).nullable().optional(),
  condition_notes: z.string().nullable().optional(),
  grade: z.enum(['A', 'B', 'C', 'D']).nullable().optional(),
});
