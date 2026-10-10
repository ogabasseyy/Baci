import { z } from 'zod';

const optionalNumber = z.preprocess((value) => {
  if (value == null || (typeof value === 'string' && value.trim() === ''))
    return undefined;
  if (typeof value === 'string' && /^\d+(\.\d{1,2})?$/.test(value.trim()))
    return Number(value);
  return value;
}, z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER).optional());

export const criteriaSchema = z
  .object({
    processor: z.string().trim().min(1).max(80).optional(),
    brands: z
      .array(
        z
          .string()
          .min(1)
          .max(160)
          .refine((value) => value.trim().length > 0)
      )
      .max(50),
    sort: z.enum(['relevance', 'price_asc', 'price_desc', 'newest', 'popular']),
    categoryId: z.string().uuid().optional(),
    condition: z.enum(['new', 'used', 'open_box']).optional(),
    minPrice: optionalNumber,
    maxPrice: optionalNumber,
    minRating: optionalNumber.pipe(z.number().min(0).max(5).optional()),
  })
  .refine(
    (value) =>
      value.minPrice === undefined ||
      value.maxPrice === undefined ||
      value.minPrice <= value.maxPrice,
    {
      message: 'Minimum price must not exceed maximum price',
      path: ['maxPrice'],
    }
  );
