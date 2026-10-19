import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type AgenticCheckoutOrderResult,
  submitSharedCartBindingOrder,
} from '@/lib/agentic/checkout-order-binding';
import {
  buildAgenticOrderItems,
  buildAgenticOrderRpcArgs,
} from '@/lib/agentic/checkout-order-rpc-args';
import {
  computeAgenticOrderTax,
  isTaxComputeUuidError,
} from '@/lib/agentic/checkout-order-tax';
import { prepareAgenticOfferEconomics } from '@/lib/agentic/prepare-agentic-offer-economics';
import { OrderConditionUnavailableError } from '@/lib/checkout/order-condition-prices';
import type { OrderOfferQueryResult } from '@/lib/checkout/verify-order-offer-lines';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';
import { orderCreateSchema } from '@/schemas/orders';
import {
  getCreatedOrderId,
  isFiniteAmountLike,
  toFiniteAmount,
} from './checkout-order-result-amounts';

const CLIENT_ORDER_ERROR_CODES = new Set([
  'invalid_items',
  'invalid_quantity',
  'invalid_variant',
  'invalid_offer',
  'invalid_condition_offer',
  'condition_offer_price_changed',
  'insufficient_condition_offer_stock',
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

export type { AgenticCheckoutOrderResult } from '@/lib/agentic/checkout-order-binding';

export async function createAgenticCheckoutOrder(
  orderPayload: Record<string, unknown>,
  supabase: SupabaseClient,
  options?: {
    /**
     * Preparing principal of the bound checkout session, resolved from
     * the server-side session record by the caller. The binding RPC
     * requires it on every submit; omitting it fails closed there.
     */
    boundPrincipalId?: string | null;
  }
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
  const orderItemsPayload = buildAgenticOrderItems(body);

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

  // Offer lines name a live offer of their own product: verify and
  // reconcile exactly like /api/orders before computing economics, or
  // the order would price and reserve the parent instead of the
  // selected offer.
  const preparedOffers = await prepareAgenticOfferEconomics(
    (productId) =>
      supabase.rpc('get_product_offers', {
        p_product_id: productId,
      }) as unknown as Promise<OrderOfferQueryResult>,
    orderItemsPayload
  );
  if (!preparedOffers.ok) {
    return preparedOffers.result;
  }
  const liveOfferPrices = preparedOffers.liveOfferPrices;

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
  const sharedCartBinding = body.shared_cart ?? null;
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
      offerPrices: liveOfferPrices,
      supabase,
    });
  } catch (taxError) {
    if (taxError instanceof OrderConditionUnavailableError) {
      if (!sharedCartBinding)
        return {
          data: { error: 'invalid_condition_offer' },
          error: 'invalid_condition_offer',
          ok: false,
          status: 400,
          statusText: 'Bad Request',
        };
      // A committed bound order must still replay when the offer has
      // since been deactivated or changed: the binding path
      // revalidates authoritatively in SQL, so fall through with the
      // request tax and let it replay or fail closed there instead of
      // refusing the retry at this mutable catalog read.
      computedTaxAmount =
        typeof body.tax_amount === 'number' ? body.tax_amount : 0;
    } else if (isTaxComputeUuidError(taxError)) {
      // A malformed product_id / variant_id from the agentic caller
      // cascades into Postgres 22P02 inside the helper. Mirror the
      // storefront route — map UUID parse errors to a 400 with
      // `invalid_items` (already in CLIENT_ORDER_ERROR_CODES and
      // the agentic spec) so the GPT agent fixes its payload.
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
    } else {
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
  }

  const orderRpcArgs = buildAgenticOrderRpcArgs(
    body,
    orderItemsPayload,
    computedTaxAmount
  );

  const bindingOutcome = sharedCartBinding
    ? await submitSharedCartBindingOrder({
        boundPrincipalId: options?.boundPrincipalId ?? null,
        orderRpcArgs: orderRpcArgs as Record<string, unknown>,
        sharedCart: sharedCartBinding,
        supabase,
      })
    : null;
  if (bindingOutcome?.kind === 'failure') return bindingOutcome.result;
  const { data: orderRows, error: orderError } = bindingOutcome
    ? { data: bindingOutcome.data, error: bindingOutcome.error }
    : await supabase.rpc('create_storefront_order', orderRpcArgs);

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
      ? code && CLIENT_ORDER_ERROR_CODES.has(code)
        ? code
        : message
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

export {
  markAgenticCheckoutOrderCanceled,
  sendAgenticOrderCreatedWebhook,
} from '@/lib/agentic/checkout-order-lifecycle';
