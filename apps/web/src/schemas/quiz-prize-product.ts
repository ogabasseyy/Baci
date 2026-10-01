import { z } from 'zod';

const quizPrizeUuidSchema = z.uuid();

export const quizPrizeProductSearchQuerySchema = z
  .object({
    cursor: z
      .string()
      .regex(/^\d+$/)
      .refine((value) => Number(value) <= Number.MAX_SAFE_INTEGER)
      .optional(),
    limit: z.coerce.number().int().min(1).max(25).default(12),
    offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
    search: z.string().trim().max(120).default(''),
  })
  .refine((value) => value.cursor === undefined || value.offset === undefined, {
    message: 'Use either cursor or offset, not both',
    path: ['cursor'],
  });

export const quizPrizeProductSchema = z.object({
  available: z.boolean(),
  condition: z.string().trim().min(1).max(80),
  defaultVariantId: quizPrizeUuidSchema.nullable(),
  effectiveStock: z.number().int().nonnegative().nullable(),
  hasVariants: z.boolean(),
  id: quizPrizeUuidSchema,
  imageUrl: z.string().trim().min(1).nullable(),
  manageStock: z.boolean(),
  name: z.string().trim().min(1).max(180),
  price: z.number().nonnegative(),
  requiresVariantSelection: z.boolean(),
  selectionId: z.string().trim().min(1).max(80),
  variantId: quizPrizeUuidSchema.nullable(),
  variantLabel: z.string().trim().min(1).max(180).nullable(),
});

export const quizPrizeProductsResponseSchema = z.object({
  nextCursor: z.string().regex(/^\d+$/).nullable(),
  products: z.array(quizPrizeProductSchema),
  total: z.number().int().nonnegative().nullable(),
});

export type QuizPrizeProduct = z.infer<typeof quizPrizeProductSchema>;
export type QuizPrizeProductsResponse = z.infer<
  typeof quizPrizeProductsResponseSchema
>;

export interface QuizPrizeProductRow {
  condition: string | null;
  default_variant_id: string | null;
  has_variants: boolean | null;
  id: string;
  images: Array<string | { url?: string | null }> | null;
  manage_stock: boolean | null;
  merchant_id: string;
  name: string;
  price: number | string | null;
  stock: number | string | null;
  stock_quantity: number | string | null;
}

export interface QuizPrizeVariantRow {
  attributes: unknown;
  condition: string | null;
  created_at?: string | null;
  id: string;
  images: Array<string | { url?: string | null }> | null;
  is_inventory_anchor?: boolean | null;
  merchant_id: string;
  price_override: number | string | null;
  primary_image: string | null;
  product_id: string;
  sku: string | null;
  stock_quantity: number | string | null;
}
