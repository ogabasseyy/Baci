import { z } from 'zod';
import {
  applyPaidOrderSideEffects,
  type PaidOrder,
} from '@/lib/payments/apply-paid-order-side-effects';
import { buildAdTrackingExecutor } from '@/lib/payments/paid-order-ad-tracking-executor';
import { buildEmailExecutor } from '@/lib/payments/paid-order-email-executor';
import { buildSettlementExecutor } from '@/lib/payments/paid-order-settlement-executor';
import type {
  RichPaidOrder,
  RunPaidOrderSideEffectsArgs,
  ServiceRoleClient,
} from '@/lib/payments/paid-order-side-effect-types';
import { toNumber } from '@/lib/payments/paid-order-side-effect-utils';

export type {
  PaidOrderSideEffectTransaction,
  RichPaidOrder,
} from '@/lib/payments/paid-order-side-effect-types';

const nullableStringSchema = z.string().nullable();
const merchantDetailsSchema = z.object({
  business_name: nullableStringSchema,
  cac_rc_number: nullableStringSchema,
  email: nullableStringSchema,
  email_sender_name: nullableStringSchema,
  slug: nullableStringSchema,
  support_email: nullableStringSchema,
  tax_identification_number: nullableStringSchema,
});
const supabaseErrorSchema = z.looseObject({
  code: z.string().optional(),
  message: z.string().optional(),
});
const SIDE_EFFECT_PAYMENT_STATUSES = new Set<RichPaidOrder['payment_status']>([
  'paid',
  'pending',
]);

export function toPaidOrder(order: RichPaidOrder): PaidOrder {
  if (!SIDE_EFFECT_PAYMENT_STATUSES.has(order.payment_status)) {
    throw new Error(
      `Paid order side effects cannot run for ${order.payment_status} orders`
    );
  }
  return {
    discount_amount: toNumber(order.discount_amount ?? 0, 'order discount'),
    gift_wrapping_fee: toNumber(
      order.gift_wrapping_fee ?? 0,
      'order gift wrapping fee'
    ),
    id: order.id,
    merchant_id: order.merchant_id,
    payment_status: 'paid',
    shipping_fee: toNumber(order.shipping_fee ?? 0, 'order shipping fee'),
    subtotal: toNumber(order.subtotal, 'order subtotal'),
    tax_amount: toNumber(order.tax_amount ?? 0, 'order tax amount'),
    tax_basis:
      order.tax_basis === 'exclusive' || order.tax_basis === 'inclusive'
        ? order.tax_basis
        : null,
    total: toNumber(order.total, 'order total'),
  };
}

async function fetchMerchantDetails(
  supabase: ServiceRoleClient,
  merchantId: string
) {
  const { data, error } = await supabase
    .from('merchants')
    .select(
      'business_name, slug, support_email, email_sender_name, email, tax_identification_number, cac_rc_number'
    )
    .eq('id', merchantId)
    .single();

  const parsedMerchant = merchantDetailsSchema.safeParse(data);
  const parsedError = supabaseErrorSchema.safeParse(error);

  return {
    data: parsedMerchant.success ? parsedMerchant.data : null,
    error: parsedError.success ? parsedError.data : null,
  };
}

export async function runPaidOrderSideEffects(
  args: RunPaidOrderSideEffectsArgs
) {
  if (args.transaction.merchant_id !== args.order.merchant_id) {
    throw new Error(
      `paid_order_merchant_mismatch: transaction ${args.transaction.id} merchant_id=${args.transaction.merchant_id} but order ${args.order.id} merchant_id=${args.order.merchant_id}`
    );
  }

  // Merchant lookup failures degrade only paid-email; settlement and ad tracking do not need merchant data.
  const merchant = await fetchMerchantDetails(
    args.supabase,
    args.transaction.merchant_id
  );

  return applyPaidOrderSideEffects({
    actor: args.actor,
    executors: {
      ad_tracking_conversion: buildAdTrackingExecutor(args),
      merchant_settlement: buildSettlementExecutor({
        ...args,
        orderShippingProvider: args.order.shipping_provider,
        orderShippingFundingSource: args.order.shipping_funding_source,
        orderShippingRetainedAmount:
          args.order.shipping_platform_retained_amount,
      }),
      paid_email: buildEmailExecutor({
        actor: args.actor,
        merchantDetails: merchant.data,
        merchantFetchError: merchant.error,
        order: args.order,
      }),
    },
    gatewayResponse: args.gatewayResponse,
    order: toPaidOrder(args.order),
    supabase: args.supabase,
    transaction: {
      amount: args.transaction.amount,
      gateway_reference: args.transaction.gateway_reference ?? null,
      id: args.transaction.id,
      merchant_id: args.transaction.merchant_id,
      order_id: args.transaction.order_id,
    },
  });
}
