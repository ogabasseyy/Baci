import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

function optionalNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function booleanRpc(
  supabaseAdmin: AdminClient,
  name: string,
  args: Record<string, unknown>
) {
  const { data, error } = await supabaseAdmin.rpc(name, args);
  if (error) throw error;
  return data === true;
}

export function createPetrockRemediationOrderState({
  customerId,
  fxRate,
  merchantId,
  supabaseAdmin,
}: {
  customerId: string;
  fxRate: number;
  merchantId: string;
  supabaseAdmin: AdminClient;
}) {
  return {
    begin({
      feedbackTokenHash,
      orderId,
      referenceId,
    }: {
      feedbackTokenHash: string;
      orderId: string;
      referenceId: string;
    }) {
      return booleanRpc(supabaseAdmin, 'begin_petrock_remediation_submission', {
        p_feedback_token_hash: feedbackTokenHash,
        p_order_id: orderId,
        p_reference_id: referenceId,
      });
    },
    finalize({
      customerMessage,
      failureReason,
      orderId,
      providerStatus,
      success,
    }: {
      customerMessage: string;
      failureReason?: string;
      orderId: string;
      providerStatus: string;
      success: boolean;
    }) {
      return booleanRpc(supabaseAdmin, 'finalize_petrock_remediation_order', {
        p_customer_message: customerMessage,
        p_failure_reason: failureReason ?? null,
        p_order_id: orderId,
        p_provider_status: providerStatus,
        p_success: success,
      });
    },
    failBeforeAcceptance({
      customerMessage,
      orderId,
      reason,
    }: {
      customerMessage: string;
      orderId: string;
      reason: string;
    }) {
      return booleanRpc(
        supabaseAdmin,
        'fail_petrock_remediation_before_acceptance',
        {
          p_customer_message: customerMessage,
          p_order_id: orderId,
          p_reason: reason,
        }
      );
    },
    markSubmissionUnknown({
      orderId,
      providerOrderId,
      reason,
    }: {
      orderId: string;
      providerOrderId?: string;
      reason: string;
    }) {
      return booleanRpc(
        supabaseAdmin,
        'mark_petrock_remediation_submission_unknown',
        {
          p_order_id: orderId,
          p_provider_order_id: providerOrderId ?? null,
          p_reason: reason,
        }
      );
    },
    async prepare({
      orderId,
      paymentCurrency,
      productId,
    }: {
      orderId: string;
      paymentCurrency: 'NGN' | 'USDT';
      productId: string;
    }) {
      const { data, error } = await supabaseAdmin.rpc(
        'prepare_petrock_remediation_order',
        {
          p_customer_id: customerId,
          p_fx_rate: fxRate,
          p_merchant_id: merchantId,
          p_order_id: orderId,
          p_payment_currency: paymentCurrency,
          p_product_id: productId,
        }
      );
      if (error) throw error;
      const row = (data ?? [])[0];
      if (!row) throw new Error('Remediation order preparation failed');
      return row;
    },
    recordSubmission({
      nextPollAt,
      orderId,
      providerOrderId,
      providerStatus,
    }: {
      nextPollAt: string;
      orderId: string;
      providerOrderId: string;
      providerStatus: string;
    }) {
      return booleanRpc(
        supabaseAdmin,
        'record_petrock_remediation_submission',
        {
          p_next_poll_at: nextPollAt,
          p_order_id: orderId,
          p_provider_order_id: providerOrderId,
          p_provider_status: providerStatus,
        }
      );
    },
    async redeem({ orderId }: { orderId: string }) {
      const { data, error } = await supabaseAdmin.rpc(
        'redeem_wallet_for_remediation',
        {
          p_customer_id: customerId,
          p_merchant_id: merchantId,
          p_order_id: orderId,
        }
      );
      if (error) throw error;
      return data;
    },
    resetPreparedQuote({
      orderId,
      reason,
    }: {
      orderId: string;
      reason: string;
    }) {
      return booleanRpc(supabaseAdmin, 'reset_petrock_remediation_quote', {
        p_order_id: orderId,
        p_reason: reason,
      });
    },
  };
}

export async function loadPetrockRemediationOrderContext({
  customerId,
  merchantId,
  orderId,
  productId,
  supabaseAdmin,
}: {
  customerId: string;
  merchantId: string;
  orderId: string;
  productId: string;
  supabaseAdmin: AdminClient;
}) {
  const { data: order, error: orderError } = await supabaseAdmin
    .from('petrock_orders')
    .select(
      'id, identifier_hash, identifier_ciphertext, status, remediation_product_id, payment_currency, amount_ngn, amount_usdt, cost_usd, fx_rate_used, eligibility_evidence, provider_order_id, provider_attempt_started_at'
    )
    .match({ customer_id: customerId, id: orderId, merchant_id: merchantId })
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order) return null;
  if (
    order.remediation_product_id &&
    String(order.remediation_product_id) !== productId
  ) {
    return null;
  }

  const { data: product, error: productError } = await supabaseAdmin
    .from('petrock_remediation_products')
    .select(
      'id, provider_product_id, cost_usd, price_ngn, price_usdt, order_field_name, is_active, manual_disabled, review_status, fixture_verified, excluded_reason, launch_carrier, carrier, model_scope, status_segment'
    )
    .match({ id: productId })
    .maybeSingle();
  if (productError) throw productError;
  if (!product) return null;

  const { data: catalog, error: catalogError } = await supabaseAdmin
    .from('imei_provider_products')
    .select(
      'product_id, price_usd, currency, order_field_name, active, synced_at'
    )
    .match({
      product_id: product.provider_product_id,
      provider: 'petrock',
      type: 'imei',
    })
    .maybeSingle();
  if (catalogError) throw catalogError;
  if (!catalog) return null;

  return {
    identifierCiphertext: String(order.identifier_ciphertext ?? ''),
    identifierHash: String(order.identifier_hash),
    order: {
      amountNgn: optionalNumber(order.amount_ngn),
      amountUsdt: optionalNumber(order.amount_usdt),
      costUsd: Number(order.cost_usd ?? product.cost_usd),
      customerId,
      eligibilityEvidence: order.eligibility_evidence,
      providerOrderId:
        typeof order.provider_order_id === 'string'
          ? order.provider_order_id
          : null,
      providerAttemptStartedAt:
        typeof order.provider_attempt_started_at === 'string'
          ? order.provider_attempt_started_at
          : null,
      id: String(order.id),
      merchantId,
      paymentCurrency:
        order.payment_currency === 'NGN' || order.payment_currency === 'USDT'
          ? order.payment_currency
          : null,
      status: String(order.status),
    },
    product: {
      carrier: String(product.carrier ?? ''),
      modelScope: product.model_scope,
      statusSegment: String(product.status_segment ?? ''),
      active:
        product.is_active === true &&
        product.manual_disabled === false &&
        product.review_status === 'approved' &&
        product.fixture_verified === true &&
        product.excluded_reason === null &&
        product.launch_carrier === true &&
        catalog.active === true &&
        catalog.currency === 'USD',
      catalogCostUsd: Number(catalog.price_usd),
      catalogOrderFieldName: String(catalog.order_field_name ?? ''),
      catalogSyncedAt: String(catalog.synced_at),
      curatedProductId: String(product.id),
      orderFieldName: String(product.order_field_name ?? ''),
      priceNgn: Number(product.price_ngn),
      priceUsdt: Number(product.price_usdt),
      providerProductId: String(product.provider_product_id),
    },
  };
}
