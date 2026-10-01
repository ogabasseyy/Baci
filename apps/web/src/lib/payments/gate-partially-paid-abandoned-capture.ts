import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { calculatePlatformFee } from '@/lib/paystack';
import { merchantInvoicePartialPaymentCompletionSchema } from '@/schemas/merchant-invoice-partial-payment-completion';
import { fileDuplicatePaymentCapture } from './file-duplicate-payment-capture';
import { fileConflictAndRetire } from './gate-partially-paid-abandoned-capture-conflict';
import { fileShortCaptureAndRetire } from './gate-partially-paid-abandoned-capture-short';
import { extractVerifiedGatewayFeeNgn } from './verified-gateway-fee';

const INVOICE_PARTIAL_ALLOCATION = 'merchant_invoice_partial';

interface GateAttempt {
  amount: number;
  gateway_reference: string;
  id: string;
  merchant_id: string;
  metadata?: Record<string, unknown> | null;
  order_id: string;
  platform_fee: number | null;
}

interface GateContext {
  attempt: GateAttempt;
  hold: (reason: string) => Promise<void>;
  providerData: Record<string, unknown>;
  summary: { completed: string[]; failed: boolean; reviewsFiled: string[] };
  supabase: SupabaseClient;
}

async function fileOverpaymentDuplicate(context: GateContext): Promise<'done'> {
  const { attempt, hold, providerData, summary, supabase } = context;
  const capture = providerData as unknown as {
    amount: number;
    currency: string;
    id: number;
    reference: string;
    status: string;
  };
  const filed = await fileDuplicatePaymentCapture({
    attempt: {
      gateway_reference: attempt.gateway_reference,
      id: attempt.id,
      merchant_id: attempt.merchant_id,
      // Unread by the filer; the stamp merges database-side so a
      // concurrent completion is never clobbered.
      metadata: null,
      order_id: attempt.order_id,
    },
    evidence: {
      gateway: 'paystack',
      providerAmount: capture.amount,
      providerCurrency: capture.currency,
      providerReference: String(capture.id),
      providerStatus: capture.status,
    },
    supabase,
  });
  if (filed) {
    summary.reviewsFiled.push(attempt.id);
    return 'done';
  }
  summary.failed = true;
  await hold('duplicate_capture_review_failed');
  return 'done';
}

/**
 * Route a verified capture on a partially paid order. Merchant-invoice
 * legs run through the atomic partial-payment RPC, which records strict
 * underpayments without promoting the order and refuses overpayments;
 * only an exact-balance capture proceeds to the generic finalizer. Other
 * legs compare the capture against the live outstanding balance first.
 * Returns 'proceed' when the generic finalizer should run.
 */
export async function gatePartiallyPaidAbandonedCapture(
  context: GateContext
): Promise<'proceed' | 'done'> {
  const { attempt, hold, providerData, summary, supabase } = context;
  if (
    attempt.metadata?.order_payment_allocation !== INVOICE_PARTIAL_ALLOCATION
  ) {
    return await gateNonInvoicePartialCapture(context);
  }
  // Mirror the webhook's settlement-input validation: the RPC enforces
  // the same contract, but the specific code names the bad input.
  const grossAmount = Number(attempt.amount);
  const gatewayFee = extractVerifiedGatewayFeeNgn('paystack', providerData);
  const storedPlatformFee =
    attempt.platform_fee == null ? null : Number(attempt.platform_fee);
  const platformFee =
    storedPlatformFee == null || storedPlatformFee === 0
      ? calculatePlatformFee(grossAmount * 100).platformFee / 100
      : storedPlatformFee;
  if (
    !Number.isFinite(grossAmount) ||
    grossAmount <= 0 ||
    !Number.isFinite(gatewayFee) ||
    gatewayFee < 0 ||
    !Number.isFinite(platformFee) ||
    platformFee < 0 ||
    gatewayFee + platformFee > grossAmount
  ) {
    return await fileConflictAndRetire(context, {
      errorCode: 'SETTLEMENT_INPUT_INVALID',
      reason: `Paystack partial payment ${attempt.gateway_reference} has invalid settlement inputs`,
    });
  }

  const { data, error } = await supabase.rpc(
    'complete_merchant_invoice_partial_payment',
    {
      p_actor: 'cron:reconcile-gateway-paid-orders',
      p_gateway_response: providerData,
      p_order_id: attempt.order_id,
      p_payment_platform_fee: platformFee,
      p_settlement_reference: attempt.gateway_reference,
      p_transaction_id: attempt.id,
      p_verified_gateway_fee: gatewayFee,
    }
  );
  const parsed = merchantInvoicePartialPaymentCompletionSchema.safeParse(data);
  if (error || !parsed.success) {
    logger.error({
      error: error ?? (parsed.success ? null : parsed.error),
      message: 'Atomic merchant invoice partial-payment completion failed',
      orderId: attempt.order_id,
      reference: attempt.gateway_reference,
      transactionId: attempt.id,
    });
    summary.failed = true;
    await hold('partial_completion_unavailable');
    return 'done';
  }

  const completion = parsed.data;
  if (completion.outcome === 'partial_recorded') {
    logger.info({
      amountApplied: completion.amount_applied,
      balanceDue: completion.balance_due,
      message: 'Merchant invoice partial payment recorded and settled',
      orderId: attempt.order_id,
      reference: attempt.gateway_reference,
      transactionId: attempt.id,
    });
    summary.completed.push(attempt.id);
    return 'done';
  }
  if (completion.outcome === 'standard_completion') {
    if (completion.reason !== 'order_terminal') {
      return 'proceed';
    }
    // The order terminalized concurrently. Cancelled and refunded orders
    // still route through the generic finalizer for its dedicated
    // classification; a paid or fully covered order means this capture
    // is excess money and owes the duplicate review directly.
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('payment_status, shipping_status, cancelled_at')
      .eq('id', attempt.order_id)
      .eq('merchant_id', attempt.merchant_id)
      .maybeSingle();
    if (orderError || !order) {
      if (orderError) summary.failed = true;
      await hold('partial_terminal_status_unavailable');
      return 'done';
    }
    const terminal = order as {
      cancelled_at: string | null;
      payment_status: string;
      shipping_status: string | null;
    };
    // Merchant cancellation leaves payment_status behind (e.g.
    // partially_paid): without the shipping/cancelled_at check the
    // capture routes to the overpayment duplicate, which stamps the
    // resolution while leaving the transaction pending — future sweeps
    // then exclude it and the cancellation-refund workflow never sees
    // the captured funds.
    if (
      terminal.payment_status === 'cancelled' ||
      terminal.payment_status === 'refunded' ||
      (terminal.cancelled_at != null &&
        (terminal.shipping_status === 'cancelled' ||
          terminal.shipping_status === 'canceled'))
    ) {
      return 'proceed';
    }
    return await fileOverpaymentDuplicate(context);
  }
  if (completion.error_code === 'AMOUNT_EXCEEDS_REMAINING_BALANCE') {
    return await fileOverpaymentDuplicate(context);
  }
  return await fileConflictAndRetire(context, {
    errorCode: completion.error_code,
    reason: `Paystack partial payment ${attempt.gateway_reference} no longer fits the merchant invoice balance (${completion.error_code})`,
  });
}

async function gateNonInvoicePartialCapture(
  context: GateContext
): Promise<'proceed' | 'done'> {
  const { attempt, hold, providerData, summary, supabase } = context;
  const { data: order, error } = await supabase
    .from('orders')
    .select('total, amount_paid')
    .eq('id', attempt.order_id)
    .eq('merchant_id', attempt.merchant_id)
    .maybeSingle();
  if (error || !order) {
    if (error) summary.failed = true;
    await hold('partial_balance_unavailable');
    return 'done';
  }
  const row = order as {
    amount_paid: number | string | null;
    total: number | string | null;
  };
  const outstanding = Math.max(
    0,
    Number(row.total ?? 0) - Number(row.amount_paid ?? 0)
  );
  const captureMinor = providerData.amount;
  if (
    typeof captureMinor !== 'number' ||
    !Number.isFinite(captureMinor) ||
    captureMinor <= 0
  ) {
    summary.failed = true;
    await hold('partial_capture_invalid');
    return 'done';
  }
  // A concurrent completion between this read and the finalizer resolves
  // through the atomic completion result (capturedOnPaidOrder files the
  // duplicate review). Compare in integer kobo: a floating-point
  // tolerance would admit genuine one-kobo shortfalls (promoting to
  // paid and fulfilling) and surpluses (bypassing the duplicate
  // review). Only an exact-balance capture proceeds. A known
  // overpayment is definitively excess money — the outstanding balance
  // can only shrink before the finalizer runs — and the finalizer
  // would promote the order to paid without the duplicate review, so
  // file it here.
  const outstandingMinor = Math.round(outstanding * 100);
  if (captureMinor === outstandingMinor) {
    return 'proceed';
  }
  if (captureMinor > outstandingMinor) {
    return await fileOverpaymentDuplicate(context);
  }
  // A verified shortfall is terminal evidence, not a transient gap: the
  // captured funds are real money below the balance, so file them for
  // operations and retire the attempt instead of rotating the hold.
  return await fileShortCaptureAndRetire(context, {
    captureMinor,
    outstandingMinor,
    providerData,
  });
}
