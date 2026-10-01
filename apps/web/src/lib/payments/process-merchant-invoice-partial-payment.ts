import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgenticPaystackDvaTransaction } from '@/lib/agentic/paystack-dva-transaction';
import { logger } from '@/lib/logger';
import { extractVerifiedGatewayFeeNgn } from '@/lib/payments/verified-gateway-fee';
import { calculatePlatformFee } from '@/lib/paystack';
import { merchantInvoicePartialPaymentCompletionSchema } from '@/schemas/merchant-invoice-partial-payment-completion';

const PARTIAL_ALLOCATION = 'merchant_invoice_partial';
const POSTGRES_UNIQUE_VIOLATION = '23505';

type ProcessingResult =
  | { kind: 'none' }
  | { kind: 'processed'; status: 200; body: Record<string, unknown> }
  | { kind: 'review'; status: 409; body: Record<string, unknown> }
  | { kind: 'error'; status: 500; body: Record<string, unknown> };

async function fileReview({
  errorCode,
  issueType,
  orderId,
  reason,
  reference,
  supabase,
  transactionId,
}: {
  errorCode: string;
  issueType: 'merchant_invoice_partial_payment_conflict';
  orderId: string;
  reason: string;
  reference: string;
  supabase: SupabaseClient;
  transactionId: string;
}): Promise<boolean> {
  try {
    const { error } = await supabase.from('reconciliation_review').insert({
      candidates: null,
      issue_type: issueType,
      metadata: { error_code: errorCode },
      order_id: orderId,
      paystack_ref: reference,
      reason,
      txn_id: transactionId,
    });
    if (!error) return true;
    if ((error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION) {
      return true;
    }
    logger.error({
      error,
      issueType,
      message: 'Failed to file merchant invoice payment review',
      orderId,
      reference,
      transactionId,
    });
  } catch (error) {
    logger.error({
      error,
      issueType,
      message: 'Merchant invoice payment review insert threw',
      orderId,
      reference,
      transactionId,
    });
  }
  return false;
}

export async function processMerchantInvoicePartialPayment({
  gateway,
  gatewayResponse,
  reference,
  supabase,
  transaction,
}: {
  gateway: 'juicyway' | 'korapay' | 'paystack';
  gatewayResponse: Record<string, unknown>;
  reference: string;
  supabase: SupabaseClient;
  transaction: AgenticPaystackDvaTransaction;
}): Promise<ProcessingResult> {
  if (transaction.metadata?.order_payment_allocation !== PARTIAL_ALLOCATION) {
    return { kind: 'none' };
  }
  if (gateway !== 'paystack' || !transaction.order_id) {
    logger.error({
      gateway,
      message: 'Invalid merchant invoice partial-payment transaction marker',
      reference,
      transactionId: transaction.id,
    });
    return {
      body: { error: 'Merchant invoice partial payment processing failed' },
      kind: 'error',
      status: 500,
    };
  }

  const grossAmount = Number(transaction.amount);
  const gatewayFee = extractVerifiedGatewayFeeNgn('paystack', gatewayResponse);
  const storedPlatformFee =
    transaction.platform_fee == null ? null : Number(transaction.platform_fee);
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
    const filed = await fileReview({
      errorCode: 'SETTLEMENT_INPUT_INVALID',
      issueType: 'merchant_invoice_partial_payment_conflict',
      orderId: transaction.order_id,
      reason: `Paystack partial payment ${reference} has invalid settlement inputs`,
      reference,
      supabase,
      transactionId: transaction.id,
    });
    return filed
      ? {
          body: {
            code: 'MERCHANT_INVOICE_PARTIAL_PAYMENT_REVIEW_REQUIRED',
            error: 'Invoice payment requires manual reconciliation',
          },
          kind: 'review',
          status: 409,
        }
      : {
          body: { error: 'Payment reconciliation review unavailable' },
          kind: 'error',
          status: 500,
        };
  }

  const { data, error } = await supabase.rpc(
    'complete_merchant_invoice_partial_payment',
    {
      p_actor: `webhook:${reference}`,
      p_gateway_response: gatewayResponse,
      p_order_id: transaction.order_id,
      p_payment_platform_fee: platformFee,
      p_settlement_reference: reference,
      p_transaction_id: transaction.id,
      p_verified_gateway_fee: gatewayFee,
    }
  );
  const parsed = merchantInvoicePartialPaymentCompletionSchema.safeParse(data);
  if (error || !parsed.success) {
    logger.error({
      error: error ?? (parsed.success ? null : parsed.error),
      message: 'Atomic merchant invoice partial-payment completion failed',
      orderId: transaction.order_id,
      reference,
      transactionId: transaction.id,
    });
    return {
      body: { error: 'Merchant invoice partial payment processing failed' },
      kind: 'error',
      status: 500,
    };
  }

  const completion = parsed.data;
  if (completion.outcome === 'standard_completion') {
    if (completion.reason === 'order_terminal') {
      const filed = await fileReview({
        errorCode: 'ORDER_TERMINAL',
        issueType: 'merchant_invoice_partial_payment_conflict',
        orderId: transaction.order_id,
        reason: `Paystack partial payment ${reference} targets a terminal order`,
        reference,
        supabase,
        transactionId: transaction.id,
      });
      return filed
        ? {
            body: {
              code: 'MERCHANT_INVOICE_PARTIAL_PAYMENT_REVIEW_REQUIRED',
              error: 'Invoice payment requires manual reconciliation',
            },
            kind: 'review',
            status: 409,
          }
        : {
            body: { error: 'Payment reconciliation review unavailable' },
            kind: 'error',
            status: 500,
          };
    }
    return { kind: 'none' };
  }
  if (completion.outcome === 'review_required') {
    const filed = await fileReview({
      errorCode: completion.error_code,
      issueType: 'merchant_invoice_partial_payment_conflict',
      orderId: transaction.order_id,
      reason: `Paystack partial payment ${reference} no longer fits the merchant invoice balance (${completion.error_code})`,
      reference,
      supabase,
      transactionId: transaction.id,
    });
    if (!filed) {
      return {
        body: { error: 'Payment reconciliation review unavailable' },
        kind: 'error',
        status: 500,
      };
    }
    return {
      body: {
        code: 'MERCHANT_INVOICE_PARTIAL_PAYMENT_REVIEW_REQUIRED',
        error: 'Invoice payment requires manual reconciliation',
      },
      kind: 'review',
      status: 409,
    };
  }

  logger.info({
    alreadyCompleted: completion.already_completed,
    amountApplied: completion.amount_applied,
    balanceDue: completion.balance_due,
    message: 'Merchant invoice partial payment recorded and settled atomically',
    orderId: transaction.order_id,
    reference,
    transactionId: transaction.id,
  });
  return {
    body: {
      amountPaid: completion.amount_paid,
      balanceDue: completion.balance_due,
      message: 'Merchant invoice partial payment recorded',
      orderNumber: completion.order_number,
      success: true,
    },
    kind: 'processed',
    status: 200,
  };
}
