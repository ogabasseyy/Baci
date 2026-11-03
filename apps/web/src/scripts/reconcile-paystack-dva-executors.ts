// `applyPaidOrderSideEffects` step executors for the manual A2
// reconcile script. Extracted to keep the entry-point script under the
// 300-line per-file cap.
//
// These executors intentionally mirror the production webhook
// (apps/web/src/app/api/payments/webhook/route.ts:1677-1834) so a
// manual reconcile produces the same external side effects as a normal
// Paystack webhook: confirmation email, ad-tracking conversion,
// settlement RPC. firs_invoice + loyalty_points are stubs until B3.5
// wires the real integrations; the Δ-31 consistency gate inside the
// outbox helper short-circuits these for orders with inconsistent
// totals (the 2026-05-09 incident shape) so the stub never runs in that case.

import {
  generateOrderConfirmationEmail,
  generateOrderConfirmationText,
} from '@/lib/email-templates';
import { getRootDomain } from '@/env';
import { calculatePlatformFee } from '@/lib/paystack';
import type {
  PaidOrder,
  PaidTransaction,
  SideEffectStep,
  StepExecutor,
} from '@/lib/payments/apply-paid-order-side-effects';
import { resolveSettlementRpcRouting } from '@/lib/payments/resolve-settlement-rpc-routing';
import { extractVerifiedGatewayFeeNgn } from '@/lib/payments/verified-gateway-fee';
import type { createServiceClient } from '@/lib/supabase/service';
import {
  type OrderForConversion,
  triggerPurchaseConversion,
} from '@/lib/trigger-purchase-conversion';
import { sendEmail } from '@/lib/zeptomail';

export type MerchantDetails = {
  business_name: string | null;
  slug: string | null;
  support_email: string | null;
  email_sender_name: string | null;
  email: string | null;
  tax_identification_number: string | null;
  cac_rc_number: string | null;
};

// Concrete shape for the rich order row the post-RPC SELECT in
// reconcile-paystack-dva.ts builds: the canonical `orders` row joined
// with `order_items`. Listing the fields explicitly lets the compiler
// validate field names and types, and lets the adTrackingExecutor pass
// the value to triggerPurchaseConversion without an `as never` cast.
//
// All paidEmailExecutor fields are optional/nullable on the wire (the
// SELECT may return null/undefined depending on the customer/order
// state), so consumers still null-coalesce. `OrderForConversion`'s
// required `id` and `total` are guaranteed by the SELECT.
export type RichOrderItem = {
  id?: string;
  product_id?: string;
  name?: string;
  price?: number | string;
  quantity?: number;
  variant_name?: string;
};

export type RichOrder = {
  id: string;
  merchant_id: string;
  payment_status: string;
  tax_basis: string | null;
  subtotal: number;
  shipping_fee: number;
  gift_wrapping_fee: number;
  tax_amount: number;
  discount_amount: number;
  total: number | string;
  order_number?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  currency?: string | null;
  shipping_provider?: string | null;
  shipping_funding_source?: 'customer_checkout' | 'merchant_wallet' | null;
  shipping_address?: {
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    zip?: string;
    postal_code?: string;
  } | null;
  order_items?: RichOrderItem[] | null;
  ad_tracking?: Record<string, unknown> | null;
};

type ServiceRoleClient = ReturnType<typeof createServiceClient>;

export type BuildScriptExecutorsArgs = {
  supabase: ServiceRoleClient;
  richOrder: RichOrder;
  order: PaidOrder;
  transaction: PaidTransaction;
  paystackReference: string;
  merchantDetails: MerchantDetails | null;
  merchantFetchError: unknown;
  rawPlatformFee: unknown;
  actor: string;
};

export function buildScriptExecutors(
  args: BuildScriptExecutorsArgs
): Partial<Record<SideEffectStep, StepExecutor>> {
  const {
    supabase,
    richOrder,
    order,
    transaction,
    paystackReference,
    merchantDetails,
    merchantFetchError,
    rawPlatformFee,
    actor,
  } = args;

  const paidEmailExecutor: StepExecutor = async () => {
    if (merchantFetchError) {
      throw new Error(
        `merchant_fetch_error: ${(merchantFetchError as { message?: string })?.message ?? 'unknown'}`
      );
    }
    if (!(merchantDetails && richOrder.customer_email)) {
      return { skipped: 'missing_merchant_or_customer_email' };
    }
    // Δ-92: guard the slug separately — its type allows null, and a
    // null slug would produce malformed URLs like https://null.usebaci.com
    // (and a support@null.usebaci.com replyTo fallback). Treat as a
    // distinct skip reason so the operator can tell merchant data is
    // wired but the slug is missing, vs the merchant row being missing
    // entirely.
    if (!merchantDetails.slug) {
      return { skipped: 'missing_merchant_slug' };
    }

    const rootDomain = getRootDomain() ?? 'usebaci.com';
    const merchantUrl = `https://${merchantDetails.slug}.${rootDomain}`;
    const orderItems = richOrder.order_items ?? [];
    const emailItems = orderItems.map((item) => ({
      name:
        item.variant_name && item.variant_name.trim().length > 0
          ? `${item.name || 'Product'} (${item.variant_name})`
          : item.name || 'Product',
      quantity: item.quantity ?? 1,
      price: typeof item.price === 'number' ? item.price : Number(item.price) || 0,
    }));

    const shippingAddress = richOrder.shipping_address ?? {};
    const emailData = {
      orderNumber: richOrder.order_number || order.id.slice(0, 8).toUpperCase(),
      customerName: richOrder.customer_name ?? '',
      items: emailItems,
      subtotal: order.subtotal,
      shippingFee: order.shipping_fee,
      total: order.total,
      currency: richOrder.currency || 'NGN',
      shippingAddress: {
        address: shippingAddress.address ?? '',
        city: shippingAddress.city ?? '',
        state: shippingAddress.state ?? '',
        phone: richOrder.customer_phone ?? '',
      },
      merchantName: merchantDetails.business_name ?? '',
      merchantUrl,
      merchantTin: merchantDetails.tax_identification_number ?? undefined,
      merchantRcNumber: merchantDetails.cac_rc_number ?? undefined,
    };

    const htmlContent = generateOrderConfirmationEmail(emailData);
    const textContent = generateOrderConfirmationText(emailData);
    const replyToEmail =
      merchantDetails.support_email ||
      merchantDetails.email ||
      `support@${merchantDetails.slug}.${rootDomain}`;
    const senderName = merchantDetails.email_sender_name
      ? `${merchantDetails.email_sender_name} Orders`
      : merchantDetails.business_name
        ? `${merchantDetails.business_name} Orders`
        : undefined;

    const result = await sendEmail({
      to: richOrder.customer_email ?? '',
      toName: richOrder.customer_name ?? undefined,
      subject: `Order Confirmation - #${emailData.orderNumber}`,
      htmlContent,
      textContent,
      replyTo: replyToEmail,
      emailType: 'orders',
      fromName: senderName,
      // Δ-61: ZeptoMail has no Idempotency-Key. The payment_side_effects
      // claim row is the dedup record; client_reference gives a server-
      // side audit trail showing which sends actually went out.
      clientReference: `order:${order.id}:paid_email`,
      auditContext: {
        merchantId: order.merchant_id,
        orderId: order.id,
        customerId: richOrder.customer_id ?? null,
        metadata: { trigger: actor },
      },
    });
    if (!result.success) {
      throw new Error(result.error || result.errorCode || 'email_failed');
    }
    return { messageId: result.messageId };
  };

  const adTrackingExecutor: StepExecutor = async () => {
    // RichOrder is a structural superset of OrderForConversion: every
    // required field on OrderForConversion (`id`, `total`) is present,
    // and the optional fields overlap. The single safe cast at this
    // boundary surfaces compile-time errors if either shape drifts.
    const orderForConversion: OrderForConversion = richOrder;
    await triggerPurchaseConversion(
      supabase,
      order.merchant_id,
      orderForConversion
    );
    return {};
  };

  const settlementExecutor: StepExecutor = async (ctx) => {
    // Mirror the finite-number guard used for rawPlatformFee below: a
    // legitimate ₦0 gross is preserved instead of silently coerced to 0.
    // A paid Paystack transaction never carries amount=0 in practice,
    // but keeping both guards consistent makes the intent obvious.
    const parsedGross = Number(transaction.amount);
    const grossAmount = Number.isFinite(parsedGross) ? parsedGross : 0;
    // Δ-0b: source the gateway fee from the verified Paystack response
    // (passed via StepContext.gatewayResponse).
    const gatewayFee = extractVerifiedGatewayFeeNgn(
      'paystack',
      ctx.gatewayResponse
    );
    // Distinguish "missing" from "legitimate zero". `Number(0) || X`
    // would treat a stored 0 the same as null/NaN and recompute, which
    // diverges from the webhook path that respects the on-record value.
    const parsedPlatformFee =
      rawPlatformFee === null || rawPlatformFee === undefined
        ? Number.NaN
        : Number(rawPlatformFee);
    const platformFee = Number.isFinite(parsedPlatformFee)
      ? parsedPlatformFee
      : calculatePlatformFee(grossAmount * 100).platformFee / 100;

    // Storefront DVAs usually split to the merchant subaccount: record those
    // as history, keep Baci-collected money spendable, and refuse a payload
    // that proves neither (throws paystack_settlement_collection_unknown).
    // Mirror paid-order-settlement-executor: GIGL customer-checkout/wallet
    // orders carry an economics snapshot and need the GIGL variant so the
    // retained delivery-fee accounting is not dropped. p_platform_fee stays
    // the base fee; the SQL wrapper adds the retention.
    const useGiglSettlementRpc =
      richOrder.shipping_funding_source != null &&
      richOrder.shipping_provider?.trim().toUpperCase() === 'GIGL';
    const routing = resolveSettlementRpcRouting({
      gatewayResponse: ctx.gatewayResponse,
      isRedvaultDirectSettlement: false,
      settlementGateway: 'paystack',
      useGiglSettlementRpc,
    });
    const { error: settlementError } = await supabase.rpc(
      routing.rpc,
      {
        ...routing.extraParams,
        p_merchant_id: order.merchant_id,
        p_source_type: 'order',
        p_source_id: order.id,
        p_gateway: 'paystack',
        // Δ-22: settlement key is our BAC-*; Paystack ref → metadata only.
        p_gateway_reference:
          transaction.gateway_reference ?? paystackReference,
        p_gross_amount: grossAmount,
        p_gateway_fee: gatewayFee,
        p_platform_fee: platformFee,
        p_description: 'Order payment via paystack (manual reconcile)',
        p_metadata: {
          paystack_reference: paystackReference,
          verified_gateway_fee: gatewayFee,
          reconciled_by: actor,
          ...routing.extraMetadata,
        },
      }
    );
    if (settlementError) {
      throw new Error(settlementError.message);
    }
    return {
      gross_amount: grossAmount,
      gateway_fee: gatewayFee,
      platform_fee: platformFee,
    };
  };

  // Stub for steps that B3.5 wires for real. The Δ-31 consistency gate
  // short-circuits these BEFORE the executor runs for inconsistent
  // orders (the 2026-05-09 incident shape); for consistent orders the stub throws and the row
  // gets `failed='wired_in_b3_5'` — replayable when the integrations
  // ship in B3.5.
  const stubExecutor: StepExecutor = () => {
    throw new Error('wired_in_b3_5');
  };

  return {
    paid_email: paidEmailExecutor,
    firs_invoice: stubExecutor,
    loyalty_points: stubExecutor,
    ad_tracking_conversion: adTrackingExecutor,
    merchant_settlement: settlementExecutor,
  };
}
