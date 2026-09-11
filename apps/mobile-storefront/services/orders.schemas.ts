import { z } from 'zod';

const MAX_SAVINGS_CREDIT_AMOUNT = 10_000_000;

const OrderItemSchema = z.object({
  id: z.string(),
  condition: z.string().optional(),
  product_id: z.string().optional(),
  name: z.string(),
  quantity: z.number().min(1),
  price: z.number().min(0),
  image_url: z.string().optional(),
  variant: z.string().optional(),
  variant_id: z.string().optional(),
  variant_name: z.string().optional(),
  variant_attributes: z.record(z.string(), z.string()).optional(),
  has_assurance: z.boolean().optional(),
  assurance_fee: z.number().min(0).optional(),
  // Quiz voucher tokens are `qv1.<base64url payload>.<base64url HMAC>` and run
  // 250-400+ chars; must match the web signing schema's 512 cap (see
  // apps/web/src/schemas/quiz.ts) or a real token is rejected client-side
  // before the order is ever sent.
  voucher_token: z
    .string()
    .trim()
    .min(1, 'Voucher token cannot be blank')
    .max(512, 'Voucher token must be 512 characters or less')
    .optional(),
  voucher_award_id: z
    .string()
    .trim()
    .min(1, 'Voucher award ID cannot be blank')
    .max(512, 'Voucher award ID must be 512 characters or less')
    .optional(),
});

const createOrderRequestSchemaBase = z.object({
  customer_email: z.email('Invalid email address'),
  customer_name: z.string().min(1, 'Name is required'),
  customer_phone: z.string().min(10, 'Valid phone number required'),
  idempotency_key: z.string().trim().min(1).max(128).optional(),
  items: z.array(OrderItemSchema).min(1, 'At least one item required'),
  subtotal: z.number().min(0),
  shipping_fee: z.number().min(0),
  tax_amount: z.number().min(0).optional(),
  expected_total: z.number().min(0).optional(),
  client_total: z.number().min(0).optional(),
  discount_amount: z.number().min(0).optional(),
  // Storefront discount code (human code string). Only the code is sent; the
  // server recomputes + validates the amount. Raw discount_amount stays 0.
  discount_code: z.string().trim().min(1).max(50).optional(),
  payment_method: z.string().min(1),
  shipping_address: z.object({
    firstName: z.string(),
    lastName: z.string(),
    address: z.string(),
    city: z.string(),
    state: z.string(),
    notes: z.string().optional(),
  }),
  selected_quote_id: z.uuid().optional(),
  shipping_provider: z.string().optional(),
  delivery_method: z.enum(['door', 'airport', 'pickup_station']).optional(),
  airport_type: z.enum(['delivery', 'pickup']).optional(),
  source: z.string().default('mobile_app'),
  use_wallet_credit: z.boolean().optional(),
  wallet_amount: z.number().nonnegative().optional(),
  use_savings_credit: z.boolean().optional(),
  savings_goal_id: z.string().trim().uuid().optional(),
  savings_amount: z
    .number()
    .positive()
    .max(MAX_SAVINGS_CREDIT_AMOUNT, 'Savings amount exceeds maximum')
    .optional(),
});

export const CreateOrderRequestSchema =
  createOrderRequestSchemaBase.superRefine((data, ctx) => {
    if (
      data.delivery_method === 'airport' &&
      !data.selected_quote_id &&
      data.airport_type === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Airport type is required for local airport delivery',
        path: ['airport_type'],
      });
    }

    if (data.delivery_method !== 'airport' && data.airport_type !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Airport type is only valid for airport delivery',
        path: ['airport_type'],
      });
    }
  });

export const OrderResponseSchema = z.object({
  order: z.object({
    id: z.string(),
    order_number: z.string().nullable(),
    total: z.number(),
    payment_status: z.string(),
    shipping_status: z.string(),
    created_at: z.string().default(() => new Date().toISOString()),
    tracking_token: z.string().nullable().optional(),
  }),
  wallet: z
    .object({
      amountUsed: z.number(),
      newBalance: z.number(),
      transactionId: z.string().nullable(),
    })
    .nullable(),
  savings: z
    .object({
      amountUsed: z.number(),
      goalId: z.string(),
      redemptionId: z.string().nullable(),
    })
    .nullable()
    .optional(),
  amountDueToGateway: z.number(),
  idempotency: z
    .object({
      replayed: z.literal(true),
    })
    .optional(),
});

export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;
export type OrderResponse = z.infer<typeof OrderResponseSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
