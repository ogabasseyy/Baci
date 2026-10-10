import { z } from 'zod';
import {
  NullableNonnegativeIntegerLikeSchema,
  NullableNumberLikeSchema,
  NumberLikeSchema,
} from './number-like-schemas';
import { ProductImageEntrySchema } from './product-image-entry-schema';

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
