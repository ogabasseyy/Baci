import { z } from 'zod';
import {
  NullableNonnegativeIntegerLikeSchema,
  NullableNumberLikeSchema,
  NumberLikeSchema,
} from './number-like-schemas';
import { ProductImageEntrySchema } from './product-image-entry-schema';

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
