import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgenticCheckoutBuyer } from '@/lib/agentic/checkout-completion-response';
import {
  computeAgenticOrderTax,
  isTaxComputeUuidError,
} from '@/lib/agentic/checkout-order-tax';
import { sendAgenticWebhook } from '@/lib/agentic/webhooks';
import { DEFAULT_ASSURANCE_RATE } from '@/lib/checkout/constants';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';
import { orderCreateSchema } from '@/schemas/orders';

const CLIENT_ORDER_ERROR_CODES = new Set([
  'invalid_items',
  'invalid_quantity',
  'invalid_variant',
  'invalid_offer',
  'insufficient_stock',
  'insufficient_variant_stock',
  'insufficient_offer_stock',
  'merchant_not_found',
  'customer_email_required',
  'customer_name_required',
  'items_required',
  'user_id_mismatch',
  'invalid_payment_status',
  'discount_amount_not_supported',
  // B3 review fix (PR #1611): the RPC now raises
  // `shipping_quote_required` when `p_shipping_provider IS NOT NULL
  // AND p_selected_quote_id IS NULL`. Without this entry, agentic
  // checkout callers that submit invalid shipping metadata get a
  // generic 500 instead of an actionable 400 — they can't tell
  // "re-quote / fix input" from "transient server issue, retry".
  // Matches the `clientErrorCodes` array in /api/orders route.ts.
  'shipping_quote_required',
  // B3.5 (PR #1622): RPC RAISES these for VAT/total/gift-wrap
  // input violations. Mirrors `clientErrorCodes` in
  // /api/orders/route.ts so agentic callers get an actionable 4xx
  // instead of a generic 500. `tax_amount_mismatch` in particular
  // should be rare now that the dispatch recomputes tax via
  // `computeAgenticOrderTax`, but is included defensively in
  // case product VAT metadata drifts mid-checkout.
  'invalid_tax_basis',
  'tax_amount_mismatch',
  'tax_amount_must_be_zero_for_non_vat_merchant',
  'gift_wrapping_fee_negative',
  'order_total_mismatch',
  '22P02',
]);

export interface AgenticCheckoutOrderResult {
  data: Record<string, unknown>;
  error?: string;
  ok: boolean;
  orderId?: string;
  status: number;
  statusText: string;
}

export async function createAgenticCheckoutOrder(
  orderPayload: Record<string, unknown>,
  supabase: SupabaseClient
): Promise<AgenticCheckoutOrderResult> {
  const parseResult = orderCreateSchema.safeParse(orderPayload);
  if (!parseResult.success) {
    return {
      data: { error: 'Invalid request data' },
      error: 'Invalid request data',
      ok: false,
      orderId: undefined,
      status: 400,
      statusText: 'Bad Request',
    };
  }

  const body = parseResult.data;
  const orderItemsPayload = body.items.map((item) => {
    const itemPrice = item.negotiatedPrice ?? item.price;
    const hasAssurance = item.has_assurance || false;

    return {
      assurance_fee: hasAssurance
        ? calculateAssuranceFee(itemPrice, item.quantity)
        : 0,
      condition: item.condition,
      has_assurance: hasAssurance,
      image_url: item.imageUrl ?? item.image_url ?? null,
      product_id: item.product_id || item.productId || item.id,
      quantity: item.quantity,
      variant_attributes:
        item.variantAttributes || item.variant_attributes || {},
      variant_id: item.variantId || item.variant_id,
    };
  });

  if (orderItemsPayload.some((item) => !item.product_id)) {
    return {
      data: { error: 'Invalid order items' },
      error: 'Invalid order items',
      ok: false,
      orderId: undefined,
      status: 400,
      statusText: 'Bad Request',
    };
  }

  // B3.5 round 5 (Codex P1, PR #1622): agentic
  // `calculateCheckoutSession` produces `tax: 0` for every line item,
  // so `body.tax_amount` is always 0 here. The RPC's
  // `tax_amount_mismatch` guard would RAISE for any VAT-registered
  // merchant. Recompute the expected per-line VAT in the dispatch
  // (matching the RPC's formula byte-for-byte) and override
  // `p_tax_amount` so the parity guard passes. The agentic GPT
  // surface will start to under-quote the buyer until
  // `calculateCheckoutSession` itself learns VAT (deferred — that
  // changes the GPTLineItem/GPTTotal shape every agentic consumer
  // depends on); the dispatch-side compute keeps the order-creation
  // path correct in the meantime.
  // Codex P2 (PR #1622 round 5): `computeAgenticOrderTax` now
  // throws on transient DB/RLS lookup failures instead of silently
  // returning 0 (which made infra errors look like client 400s).
  // Wrap the call so a failure surfaces as a 500 the GPT-agent
  // caller can retry — distinct from the validation-shaped 400s
  // the RPC itself produces.
  let computedTaxAmount: number;
  try {
    // CodeRabbit High (PR #1622 round 7): use the caller-supplied
    // scoped client; the helper's only RLS-bypassing read goes
    // through the `get_order_variant_overrides` SECURITY DEFINER
    // RPC at the database layer. The Next.js layer never
    // escalates to service-role.
    computedTaxAmount = await computeAgenticOrderTax({
      items: orderItemsPayload,
      merchantId: body.merchant_id,
      supabase,
    });
  } catch (taxError) {
    // Codex P2 (PR #1622 round 7): a malformed product_id /
    // variant_id from the agentic caller cascades into Postgres
    // 22P02 inside the helper. Mirror the storefront route — map
    // UUID parse errors to a 400 with `invalid_items` (already
    // in `CLIENT_ORDER_ERROR_CODES` and the agentic spec) so the
    // GPT agent fixes its payload instead of treating this as
    // an outage.
    if (isTaxComputeUuidError(taxError)) {
      logger.warn({
        error: sanitizeForLog(taxError),
        message: 'Agentic checkout received malformed item identifier',
      });
      return {
        data: { error: 'invalid_items' },
        error: 'invalid_items',
        ok: false,
        orderId: undefined,
        status: 400,
        statusText: 'Bad Request',
      };
    }
    logger.error({
      error: sanitizeForLog(taxError),
      message: 'Agentic checkout VAT recompute failed',
    });
    return {
      data: { error: 'Unable to compute order tax' },
      error: 'Unable to compute order tax',
      ok: false,
      orderId: undefined,
      status: 500,
      statusText: 'Internal Server Error',
    };
  }

  const { data: orderRows, error: orderError } = await supabase.rpc(
    'create_storefront_order',
    {
      p_ad_tracking: body.ad_tracking ?? null,
      p_customer_email: body.customer_email,
      p_customer_name: body.customer_name,
      p_customer_phone: body.customer_phone ?? null,
      p_discount_amount: body.discount_amount,
      p_items: orderItemsPayload,
      p_merchant_id: body.merchant_id,
      p_notes: body.notes ?? null,
      p_payment_method: body.payment_method,
      p_payment_status: body.payment_status,
      p_selected_quote_id: body.selected_quote_id || null,
      p_shipping_address: body.shipping_address || null,
      p_shipping_fee: body.shipping_fee,
      p_shipping_provider: body.shipping_provider ?? null,
      p_shipping_status: body.shipping_status,
      p_source: body.source,
      p_tax_amount: computedTaxAmount,
      // Codex P1 (PR #1622 round 7): forward `p_gift_wrapping_fee`
      // through to the RPC. The agentic
      // `calculateCheckoutSession` doesn't quote gift wrapping
      // today, so `body.gift_wrapping_fee` is currently the Zod
      // default 0 — but the schema accepts the field, and
      // omitting it from the RPC call left a silent
      // under-quote path waiting for the first agentic flow that
      // does pass it. The RPC's `gift_wrapping_fee_negative`
      // guard + the column's CHECK `>= 0` jointly clamp invalid
      // input.
      p_gift_wrapping_fee: body.gift_wrapping_fee,
      // Codex P1 (PR #1622 round 8): forward
      // `body.expected_total` to enable the RPC's
      // `order_total_mismatch` parity guard for agentic flows.
      // Today `calculateCheckoutSession` doesn't quote VAT, so
      // the agentic completion payload never includes
      // `expected_total` and this is `null` (parity check
      // skipped — matches existing behavior; fabricating a
      // value from the VAT-exclusive quote would break every
      // VAT-registered agentic checkout with a mismatch the
      // agent can't recover from until session calc learns
      // VAT). When `calculateCheckoutSession` is upgraded to
      // emit a VAT-inclusive total (deferred follow-up tracked
      // separately), `buildOrderRpcPayload` will start setting
      // `expected_total` and this wiring activates the parity
      // guard automatically — no second round trip here.
      p_expected_total:
        typeof body.expected_total === 'number' ? body.expected_total : null,
      p_tracking_number: body.tracking_number ?? null,
      // Agentic checkout is API-key scoped, not tied to a customer auth session.
      p_user_id: null,
    }
  );

  const order = Array.isArray(orderRows) ? orderRows[0] : orderRows;
  if (orderError || !order) {
    const code = typeof orderError?.code === 'string' ? orderError.code : null;
    const message =
      typeof orderError?.message === 'string'
        ? orderError.message
        : code || 'Failed to create order';
    const isClientError =
      (code ? CLIENT_ORDER_ERROR_CODES.has(code) : false) ||
      CLIENT_ORDER_ERROR_CODES.has(message);
    const safeError = isClientError
      ? (code ?? message)
      : 'Unable to create order';

    logger.error({
      code,
      error: sanitizeForLog(orderError),
      message: 'Agentic checkout order RPC failed',
    });

    return {
      data: { details: safeError, error: 'Failed to create order' },
      error: safeError,
      ok: false,
      orderId: undefined,
      status: isClientError ? 400 : 500,
      statusText: isClientError ? 'Bad Request' : 'Internal Server Error',
    };
  }

  const orderId = typeof order.id === 'string' ? order.id : undefined;
  if (!isFiniteAmountLike(order.total)) {
    logger.error({
      message: 'Agentic checkout order returned invalid total',
      orderId,
      total: sanitizeForLog(order.total),
    });
    return {
      data: { error: 'Invalid order total' },
      error: 'Invalid order total',
      ok: false,
      orderId: undefined,
      status: 422,
      statusText: 'Unprocessable Entity',
    };
  }
  const amountDueToGateway = toFiniteAmount(order.total);
  const data = {
    amountDueToGateway,
    order,
    wallet: null,
  };

  return {
    data,
    error: undefined,
    ok: true,
    orderId: getCreatedOrderId(data),
    status: 201,
    statusText: 'Created',
  };
}

export function sendAgenticOrderCreatedWebhook({
  buyer,
  currency,
  orderId,
  sessionId,
  total,
}: {
  buyer: AgenticCheckoutBuyer;
  currency: string;
  orderId: string;
  sessionId: string;
  total?: number | string;
}) {
  sendAgenticWebhook('order.created', {
    id: orderId,
    currency,
    total,
    status: 'pending',
    buyer,
  }).catch((err) =>
    logger.error({
      message: 'Webhook trigger failed',
      error: sanitizeForLog(err),
      sessionId,
    })
  );
}

export async function markAgenticCheckoutOrderCanceled({
  merchantId,
  orderId,
  supabase,
}: {
  merchantId: string;
  orderId: string;
  sessionId: string;
  supabase: SupabaseClient;
}) {
  const { data, error } = await supabase
    .from('orders')
    .update({
      payment_status: 'cancelled',
      shipping_status: 'cancelled',
    })
    .eq('id', orderId)
    .eq('merchant_id', merchantId)
    .in('payment_status', ['pending', 'unpaid'])
    .in('shipping_status', ['pending'])
    .select('id')
    .maybeSingle();

  return { error, updated: !error && !!data };
}

function calculateAssuranceFee(itemPrice: number, quantity: number) {
  return Math.round(itemPrice * quantity * DEFAULT_ASSURANCE_RATE * 100) / 100;
}

function isFiniteAmountLike(value: unknown) {
  return (
    value !== null && value !== undefined && Number.isFinite(Number(value))
  );
}

function toFiniteAmount(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function getCreatedOrderId(data: Record<string, unknown>) {
  const order = data.order;
  if (order && typeof order === 'object' && 'id' in order) {
    const id = (order as { id?: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  }

  return typeof data.id === 'string' ? data.id : undefined;
}
