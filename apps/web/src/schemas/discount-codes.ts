import { z } from 'zod';

const discountCodeFields = {
  // RDM- is reserved for loyalty redemptions (issue #3165): checkout
  // resolves merchant codes first, so a merchant RDM-* code would
  // shadow the loyalty redemption even after points+stock. The refine
  // sees the uppercased value, so the reservation is case-insensitive.
  code: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .toUpperCase()
    .refine((c) => !c.startsWith('RDM-'), {
      message: 'Code prefix RDM- is reserved for loyalty redemptions',
    }),
  description: z.string().max(500).nullable().optional(),
  discount_type: z.enum(['percentage', 'fixed_amount']),
  discount_value: z.number().positive(),
  minimum_purchase_amount: z.number().nonnegative().optional(),
  maximum_discount_amount: z.number().positive().nullable().optional(),
  usage_limit: z.int().positive().nullable().optional(),
  usage_limit_per_customer: z.int().positive().optional(),
  starts_at: z.iso.datetime().nullable().optional(),
  expires_at: z.iso.datetime().nullable().optional(),
  is_active: z.boolean().optional(),
  applies_to: z
    .enum(['all', 'specific_products', 'specific_categories'])
    .optional(),
  product_ids: z.array(z.uuid()).optional(),
  category_ids: z.array(z.uuid()).optional(),
};

const discountCodeBaseFields = z.object({
  ...discountCodeFields,
  minimum_purchase_amount:
    discountCodeFields.minimum_purchase_amount.default(0),
  usage_limit_per_customer:
    discountCodeFields.usage_limit_per_customer.default(1),
  is_active: discountCodeFields.is_active.default(true),
  applies_to: discountCodeFields.applies_to.default('all'),
  product_ids: discountCodeFields.product_ids.default([]),
  category_ids: discountCodeFields.category_ids.default([]),
});

const discountCodeUpdateFields = z.object(discountCodeFields).partial();

type DiscountCodeTargetingInput = {
  applies_to?: 'all' | 'specific_products' | 'specific_categories';
  product_ids?: string[];
  category_ids?: string[];
};

const appliesToRefinement = (data: DiscountCodeTargetingInput): boolean => {
  if (data.applies_to === 'specific_products') {
    return data.product_ids !== undefined && data.product_ids.length > 0;
  }
  if (data.applies_to === 'specific_categories') {
    return data.category_ids !== undefined && data.category_ids.length > 0;
  }
  return true;
};

export const createDiscountCodeSchema = discountCodeBaseFields.refine(
  appliesToRefinement,
  {
    path: ['applies_to'],
    error:
      'product_ids or category_ids must be provided when applies_to targets them',
  }
);

export const updateDiscountCodeSchema = discountCodeUpdateFields.refine(
  (data) => {
    // Only validate applies_to relationship when applies_to is explicitly provided
    if (data.applies_to === 'specific_products') {
      return data.product_ids !== undefined && data.product_ids.length > 0;
    }
    if (data.applies_to === 'specific_categories') {
      return data.category_ids !== undefined && data.category_ids.length > 0;
    }
    return true;
  },
  {
    path: ['applies_to'],
    error:
      'product_ids or category_ids must be provided when applies_to targets them',
  }
);

export const validateDiscountCodeSchema = z.object({
  code: z.string().trim().min(1),
  merchantId: z.uuid(),
  customerEmail: z.email().optional(),
  orderTotal: z.number().nonnegative(),
  productIds: z.array(z.uuid()).optional().default([]),
  categoryIds: z.array(z.uuid()).optional().default([]),
});
