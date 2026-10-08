import type { PaymentStatus, ShippingStatus } from '@baci/shared';
import { z } from 'zod';

const moneySchema = z.number().finite().nonnegative();

const editCustomerSchema = z.object({
  email: z.email().nullable().optional(),
  id: z.uuid().nullable(),
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(40).nullable().optional(),
});

const editShippingAddressSchema = z.object({
  address: z.string().trim().max(500),
  city: z.string().trim().max(100).nullable().optional(),
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(40),
  state: z.string().trim().max(100).nullable().optional(),
});

const editOrderItemSchema = z.object({
  condition: z.string().trim().max(100).nullable().optional(),
  image_url: z.string().trim().max(2000).nullable().optional(),
  item_description: z.string().trim().max(1000).nullable().optional(),
  name: z.string().trim().min(1).max(200),
  price: moneySchema,
  product_id: z.uuid().nullable(),
  product_match_status: z.enum(['custom', 'linked', 'unreviewed']).optional(),
  quantity: z.number().int().positive().max(999),
  variant_id: z.uuid().nullable(),
  variant_attributes: z.record(z.string(), z.unknown()).nullable().optional(),
  variant_name: z.string().trim().max(200).nullable(),
});

export const adminOrderEditSchema = z
  .object({
    transaction_date: z.iso
      .datetime({ offset: true })
      .refine(
        (value) => new Date(value).getTime() <= Date.now(),
        'Order date cannot be in the future'
      )
      .optional(),
    branch_id: z.uuid().nullable(),
    customer: editCustomerSchema,
    discount_amount: moneySchema,
    gift_wrapping_fee: moneySchema.optional(),
    items: z.array(editOrderItemSchema).min(1).max(200),
    notes: z.string().trim().max(2000).nullable().optional(),
    notify_customer: z.boolean().default(false),
    shipping_address: editShippingAddressSchema,
    shipping_fee: moneySchema,
    source: z.string().trim().min(1).max(50).nullable(),
    tax_amount: moneySchema,
  })
  .refine(
    (value) => {
      if (value.gift_wrapping_fee === undefined) {
        return true;
      }

      const subtotal = value.items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      return (
        subtotal -
          value.discount_amount +
          value.gift_wrapping_fee +
          value.shipping_fee +
          value.tax_amount >=
        0
      );
    },
    {
      message:
        'Discount cannot exceed order subtotal plus fees, gift wrapping, and tax',
      path: ['discount_amount'],
    }
  );

export type AdminOrderEditInput = z.infer<typeof adminOrderEditSchema>;

const FINANCIAL_FIELDS = new Set([
  'discount_amount',
  'gift_wrapping_fee',
  'items',
  'shipping_fee',
  'subtotal',
  'tax_exclusive_amount',
  'tax_inclusive_amount',
  'tax_amount',
  'total',
]);

const CUSTOMER_VISIBLE_FIELDS = new Set([
  'customer_email',
  'customer_name',
  'customer_phone',
  'discount_amount',
  'gift_wrapping_fee',
  'items',
  'shipping_address',
  'shipping_fee',
  'tax_exclusive_amount',
  'tax_inclusive_amount',
  'tax_amount',
  'total',
]);

const PAYMENT_LOCK_STATUSES = new Set<PaymentStatus | string>([
  'paid',
  'partially_paid',
  'bnpl_approved',
  'refunded',
]);

export function getOrderEditChangeCategory(input: {
  changedFields: string[];
}): 'financial' | 'customer_visible' | 'internal' {
  if (input.changedFields.some((field) => FINANCIAL_FIELDS.has(field))) {
    return 'financial';
  }

  if (input.changedFields.some((field) => CUSTOMER_VISIBLE_FIELDS.has(field))) {
    return 'customer_visible';
  }

  return 'internal';
}

export function canEditFinancialOrderFields(input: {
  amountPaid: number;
  paymentStatus: PaymentStatus | string | null;
  shippingStatus: ShippingStatus | string | null;
  walletAmountUsed: number;
}): boolean {
  if (
    input.amountPaid > 0 ||
    input.walletAmountUsed > 0 ||
    PAYMENT_LOCK_STATUSES.has(input.paymentStatus ?? '')
  ) {
    return false;
  }

  return !['shipped', 'delivered', 'cancelled', 'returned'].includes(
    input.shippingStatus ?? ''
  );
}
