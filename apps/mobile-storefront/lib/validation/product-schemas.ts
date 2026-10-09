import { z } from 'zod';
import {
  NullableNonnegativeIntegerLikeSchema,
  NullableNumberLikeSchema,
  NumberLikeSchema,
} from './number-like-schemas';
import { ProductConditionOfferSchema } from './product-condition-offer-schema';
import { ProductImageEntrySchema } from './product-image-entry-schema';
import { ProductVariantSchema } from './product-variant-schema';

export const MerchantRowSchema = z.object({
  id: z.uuid(),
  slug: z.string().optional(),
  name: z.string().optional(),
});

export type MerchantRow = z.infer<typeof MerchantRowSchema>;

export const CustomerRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid().nullable().optional(),
  email: z.email(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  loyalty_points: z.number().nullable().optional(),
  username: z.string().nullable().optional(),
  username_changed_at: z.string().nullable().optional(),
  date_of_birth: z.string().nullable().optional(),
});

export type CustomerRow = z.infer<typeof CustomerRowSchema>;

export const OrderRowSchema = z.object({
  id: z.uuid(),
  order_number: z.string().nullable().optional(),
  total: z.number().optional(),
  payment_status: z.string().optional(),
  shipping_status: z.string().optional(),
  tracking_number: z.string().nullable().optional(),
  shipping_provider: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export type OrderRow = z.infer<typeof OrderRowSchema>;

const VariantAttributeEntrySchema = z.object({
  param: z.string(),
  options: z.array(z.string()),
});

const ProductColorSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    value: z.string().optional(),
  }),
]);

const VariantAttributeRecordSchema = z.record(
  z.string(),
  z.union([z.array(z.string()), z.string(), z.null()])
);

const ProductSpecificationRecordSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.unknown()])
);

export const ProductRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  price: NumberLikeSchema,
  compare_at_price: NullableNumberLikeSchema.optional(),
  created_at: z.string().nullable().optional(),
  images: z.array(ProductImageEntrySchema).nullable().optional(),
  brand: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  condition: z.string().nullable().optional(),
  average_rating: NullableNumberLikeSchema.refine(
    (value) => value == null || (value >= 0 && value <= 5),
    { message: 'average_rating must be between 0 and 5' }
  ).optional(),
  review_count: NullableNonnegativeIntegerLikeSchema.optional(),
  manage_stock: z.boolean().nullable().optional(),
  stock: NullableNonnegativeIntegerLikeSchema.optional(),
  stock_quantity: NullableNonnegativeIntegerLikeSchema.optional(),
  base_effective_policy: z.string().nullable().optional(),
  base_available_units: NullableNonnegativeIntegerLikeSchema.optional(),
  status: z.string().optional(),
  specifications: z
    .union([
      ProductSpecificationRecordSchema,
      z.array(
        z.object({
          category: z.string().optional(),
          items: z
            .array(
              z.object({
                label: z.string().optional(),
                value: z.unknown().optional(),
              })
            )
            .optional(),
        })
      ),
      z.array(z.unknown()),
    ])
    .nullable()
    .optional(),
  has_variants: z.boolean().nullable().optional(),
  variant_model: z.enum(['legacy', 'sku_matrix']).nullable().optional(),
  available_conditions: z.array(z.string()).nullable().optional(),
  variant_attributes: z
    .union([
      z.array(VariantAttributeEntrySchema),
      z.array(z.string()),
      VariantAttributeRecordSchema,
      z.record(z.string(), z.unknown()),
      z.array(z.unknown()),
    ])
    .nullable()
    .optional(),
  variants: z.array(ProductVariantSchema).nullable().optional(),
  colors: z.array(ProductColorSchema).nullable().optional(),
  color_images: z
    .record(z.string(), z.array(ProductImageEntrySchema).nullable().optional())
    .nullable()
    .optional(),
  has_condition_offers: z.boolean().nullable().optional(),
  offers: z.array(ProductConditionOfferSchema).nullable().optional(),
  categories: z
    .union([
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          slug: z.string(),
        })
      ),
      z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
      }),
    ])
    .nullable()
    .optional(),
});

export type ProductRow = z.infer<typeof ProductRowSchema>;

export const WalletRowSchema = z.object({
  id: z.uuid(),
  available_balance: z.number().default(0),
});

export type WalletRow = z.infer<typeof WalletRowSchema>;

export const TransactionRowSchema = z.object({
  id: z.uuid(),
  type: z.enum([
    'credit',
    'debit',
    'cashback',
    'redemption',
    'bonus',
    'adjustment',
    'expiry',
    'refund',
  ]),
  amount: z.number(),
  description: z.string().nullable().optional(),
  created_at: z.string(),
  /** `wallet_topup` (funding) vs `vtu_transaction` (cashback), `order_reversal`… */
  source_type: z.string().nullable().optional(),
});

export type TransactionRow = z.infer<typeof TransactionRowSchema>;

export function isOrderRealtimePayload(
  payload: unknown
): payload is { new: OrderRow; old?: OrderRow | null } {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  if (!('new' in p) || typeof p.new !== 'object' || p.new === null)
    return false;
  const newResult = OrderRowSchema.safeParse(p.new);
  if (!newResult.success) return false;
  if (!('old' in p) || p.old == null) return true;
  return OrderRowSchema.safeParse(p.old).success;
}

export function isWalletRealtimePayload(
  payload: unknown
): payload is { new: WalletRow; old?: WalletRow | null } {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  if (!('new' in p) || typeof p.new !== 'object' || p.new === null)
    return false;
  const newResult = WalletRowSchema.safeParse(p.new);
  if (!newResult.success) return false;
  if (!('old' in p) || p.old == null) return true;
  return WalletRowSchema.safeParse(p.old).success;
}

export function isCustomerRealtimePayload(
  payload: unknown
): payload is { new: CustomerRow; old?: CustomerRow | null } {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  if (!('new' in p) || typeof p.new !== 'object' || p.new === null)
    return false;
  const newResult = CustomerRowSchema.safeParse(p.new);
  if (!newResult.success) return false;
  if (!('old' in p) || p.old == null) return true;
  return CustomerRowSchema.safeParse(p.old).success;
}

export function parseApiResponse<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context?: string
): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.warn(
      'API response validation failed',
      context ? `(${context})` : '',
      result.error.issues.map((issue) => JSON.stringify(issue))
    );
    return null;
  }
  return result.data;
}
