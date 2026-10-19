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

const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Order day must use YYYY-MM-DD')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, 'Order day must be a valid calendar date');

export const adminOrderEditSchema = z
  .object({
    // No lower bound by design: merchants may correct arbitrarily old
    // manual sales, matching update_transaction_review_details.
    transaction_date: z.iso
      .datetime({ offset: true })
      .refine(
        (value) => new Date(value).getTime() <= Date.now(),
        'Order date cannot be in the future'
      )
      .optional(),
    // Device-local calendar day of the picked date, mirroring order
    // creation. Optional for older clients; the server falls back to
    // merchant-timezone derivation when it is absent.
    transaction_date_day: calendarDaySchema.optional(),
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
    (value) =>
      value.transaction_date_day === undefined ||
      value.transaction_date !== undefined,
    {
      message: 'Order date is required when the order day is present',
      path: ['transaction_date'],
    }
  )
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
