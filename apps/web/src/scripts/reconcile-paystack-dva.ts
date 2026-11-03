// Phase A — A2 manual reconcile script (Δ-8, Δ-11, Δ-12, Δ-13, Δ-15,
// Δ-18, Δ-23, Δ-25, Δ-28, Δ-31, Δ-66, Δ-67, Δ-86, Δ-87).
//
// "Paystack DVA confirmed paid but our DB still says pending." Args
// are validated by the Zod-backed parser in `./reconcile-paystack-dva-
// args.ts`; outbox executors live in `./reconcile-paystack-dva-
// executors.ts`. This file orchestrates: verify → atomic RPC → reload
// → outbox.
//
// Δ-31: orders whose totals don't match their `tax_basis` see
// `firs_invoice` and `loyalty_points` short-circuit to `failed,
// error='financial_totals_inconsistent'`. Replay after B3.5 backfill
// retakes the failed claims and finishes them.

import 'dotenv/config';

import { pathToFileURL } from 'node:url';
import { logger } from '@/lib/logger';
import { verifyTransaction } from '@/lib/paystack';
import { applyPaidOrderSideEffects } from '@/lib/payments/apply-paid-order-side-effects';
import { completeOrderGatewayPayment } from '@/lib/payments/complete-order-gateway-payment';
import { createServiceClient } from '@/lib/supabase/service';
import { parseReconcileArgs } from '@/scripts/reconcile-paystack-dva-args';
import {
  buildScriptExecutors,
  type MerchantDetails,
  type RichOrder,
} from '@/scripts/reconcile-paystack-dva-executors';
import {
  computeExitCode,
  normalizePaidOrder,
  normalizePaidTransaction,
} from '@/scripts/reconcile-paystack-dva-internals';

const ACTOR = 'script:reconcile-paystack-dva';

export async function runReconcilePaystackDvaCli(
  argv: readonly string[]
): Promise<number> {
  const parsed = parseReconcileArgs(argv);
  if (!parsed.ok) {
    logger.error({
      message: 'reconcile-paystack-dva: invalid arguments',
      error: parsed.error,
    });
    return 1;
  }
  const args = parsed.args;

  // Δ-66: outbox + RPC are GRANTed only to service_role. Build the
  // service client at startup so every downstream call uses it.
  const supabase = createServiceClient();

  // Step 1 — external Paystack verify. Bail on mismatch; the atomic RPC
  // would happily flip the wrong transaction otherwise.
  const verify = await verifyTransaction(args.paystackReference);
  if (!verify.success) {
    logger.error({
      message: 'reconcile-paystack-dva: paystack verify failed',
      paystackReference: args.paystackReference,
      error: verify.error,
    });
    return 1;
  }
  if (verify.data.status !== 'success') {
    logger.error({
      message: 'reconcile-paystack-dva: paystack reports non-success status',
      paystackReference: args.paystackReference,
      status: verify.data.status,
    });
    return 1;
  }
  if (verify.data.currency !== 'NGN') {
    logger.error({
      message: 'reconcile-paystack-dva: paystack currency is not NGN',
      paystackReference: args.paystackReference,
      currency: verify.data.currency,
    });
    return 1;
  }

  // Step 2 — load the on-record transaction's amount so we can sanity-
  // check the Paystack-verified amount before mutating anything. Only
  // `amount` is used at this step; the post-RPC fetch below selects the
  // wider shape the executors need.
  const { data: txnRow, error: txnErr } = await supabase
    .from('transactions')
    .select('amount')
    .eq('id', args.transactionId)
    .single();
  if (txnErr || !txnRow) {
    logger.error({
      message: 'reconcile-paystack-dva: transaction lookup failed',
      transactionId: args.transactionId,
      error: txnErr?.message ?? 'no row',
    });
    return 1;
  }
  const onRecordAmount = Number((txnRow as { amount: unknown }).amount);
  // Paystack returns kobo on /transaction/verify; convert to NGN.
  const verifiedAmountNgn = verify.data.amount / 100;
  if (
    !Number.isFinite(onRecordAmount) ||
    Math.abs(verifiedAmountNgn - onRecordAmount) > 0.01
  ) {
    logger.error({
      message: 'reconcile-paystack-dva: amount mismatch',
      transactionId: args.transactionId,
      verifiedAmountNgn,
      onRecordAmount,
    });
    return 1;
  }

  // Step 3 — atomic claim. Single PL/pgSQL call so the txn flip + order
  // flip + duplicate cancellations happen under one DB transaction.
  const rpcResult = await supabase.rpc('claim_paystack_paid_atomic', {
    p_transaction_id: args.transactionId,
    p_paystack_reference: args.paystackReference,
    // Δ-59: plain TS object; PostgREST converts to jsonb at the wire.
    p_gateway_response: verify.data as unknown as Record<string, unknown>,
    p_canonical_order_id: args.canonicalOrderId,
    p_operator_user_id: args.operatorUserId,
    p_cancel_order_ids: args.cancelOrders,
    p_operator_label: ACTOR,
  });
  if (rpcResult.error) {
    logger.error({
      message: 'reconcile-paystack-dva: claim_paystack_paid_atomic raised',
      transactionId: args.transactionId,
      canonicalOrderId: args.canonicalOrderId,
      error: rpcResult.error.message,
    });
    return 1;
  }
  const rpcReport = rpcResult.data as Record<string, unknown> | null;
  console.log(
    JSON.stringify(
      { stage: 'claim_paystack_paid_atomic', report: rpcReport },
      null,
      2
    )
  );

  // The legacy claim RPC predates the canonical payment ledger fields. Run
  // the modern idempotent completion RPC before side effects so a recovered
  // order always has amount_paid and paid_at populated from Paystack's
  // verified response. This is safe on replay: the RPC locks per order and
  // only heals missing ledger fields when the order is already paid.
  const ledgerCompletion = await completeOrderGatewayPayment({
    supabase,
    transactionId: args.transactionId,
    orderId: args.canonicalOrderId,
    gatewayResponse: verify.data as unknown as Record<string, unknown>,
    actor: ACTOR,
  });
  if (
    !ledgerCompletion.ok ||
    ledgerCompletion.completion.error_code !== undefined
  ) {
    logger.error({
      message: 'reconcile-paystack-dva: payment ledger completion failed',
      transactionId: args.transactionId,
      canonicalOrderId: args.canonicalOrderId,
      error: ledgerCompletion.ok
        ? ledgerCompletion.completion.error_code
        : ledgerCompletion.error,
    });
    return 1;
  }

  // Step 4 — load the freshly-paid order with the rich shape the
  // executors need (customer fields, shipping_address, order_items).
  const { data: paidTxnRow, error: paidTxnErr } = await supabase
    .from('transactions')
    .select(
      'id, order_id, merchant_id, gateway_reference, amount, platform_fee'
    )
    .eq('id', args.transactionId)
    .single();
  if (paidTxnErr || !paidTxnRow) {
    logger.error({
      message: 'reconcile-paystack-dva: post-RPC txn lookup failed',
      transactionId: args.transactionId,
      error: paidTxnErr?.message ?? 'no row',
    });
    return 1;
  }

  const { data: orderRow, error: orderErr } = await supabase
    .from('orders')
    .select(
      'id, merchant_id, payment_status, tax_basis, subtotal, shipping_fee, gift_wrapping_fee, tax_amount, discount_amount, total, order_number, customer_id, customer_name, customer_email, customer_phone, currency, shipping_provider, shipping_funding_source, shipping_address, order_items(id, product_id, name, price, quantity, variant_name)'
    )
    .eq('id', args.canonicalOrderId)
    .single();
  if (orderErr || !orderRow) {
    logger.error({
      message: 'reconcile-paystack-dva: post-RPC order lookup failed',
      canonicalOrderId: args.canonicalOrderId,
      error: orderErr?.message ?? 'no row',
    });
    return 1;
  }

  // The SELECT above pins the field list to RichOrder's shape; the
  // unknown→RichOrder cast at this boundary is the single point where
  // we trust the database driver. Downstream consumers get a typed
  // value and avoid scattered `as` assertions.
  const richOrder = orderRow as unknown as RichOrder;
  const order = normalizePaidOrder(richOrder);
  const transaction = normalizePaidTransaction(
    paidTxnRow as Record<string, unknown>
  );

  // .maybeSingle() returns data === null for the no-row case instead of
  // raising PGRST116. paidEmailExecutor's `!(merchantDetails && ...)`
  // skip-guard treats null as "no merchant" and continues with the
  // other side effects. Any other error (network blip, transient DB
  // outage) still surfaces as merchantErr and gets thrown by the
  // executor so the claim retries.
  const { data: merchantDetails, error: merchantErr } = await supabase
    .from('merchants')
    .select(
      'business_name, slug, support_email, email_sender_name, email, tax_identification_number, cac_rc_number'
    )
    .eq('id', order.merchant_id)
    .maybeSingle();
  const merchantFetchError = merchantErr ?? null;

  const rawPlatformFee = (paidTxnRow as { platform_fee: unknown })
    .platform_fee;

  const executors = buildScriptExecutors({
    supabase,
    richOrder,
    order,
    transaction,
    paystackReference: args.paystackReference,
    merchantDetails: merchantDetails as MerchantDetails | null,
    merchantFetchError,
    rawPlatformFee,
    actor: ACTOR,
  });

  const sideEffectsResult = await applyPaidOrderSideEffects({
    supabase,
    order,
    transaction,
    gatewayResponse: verify.data as unknown as Record<string, unknown>,
    actor: ACTOR,
    executors,
  });

  console.log(
    JSON.stringify(
      { stage: 'apply_paid_order_side_effects', result: sideEffectsResult },
      null,
      2
    )
  );

  return computeExitCode(sideEffectsResult);
}

const currentFile = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (import.meta.url === currentFile) {
  runReconcilePaystackDvaCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      logger.error({
        message: 'reconcile-paystack-dva: unhandled error',
        error: err instanceof Error ? err.message : String(err),
      });
      process.exitCode = 1;
    });
}
