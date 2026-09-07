import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { after, type NextRequest, NextResponse } from 'next/server';
import { markAgenticPaystackDvaSessionPaid } from '@/lib/agentic/paystack-dva-session-paid';
import {
  AGENTIC_PAYSTACK_DVA_TRANSACTION_SELECT,
  type AgenticPaystackDvaTransaction,
  normalizeAgenticPaystackDvaTransaction,
} from '@/lib/agentic/paystack-dva-transaction';
import {
  confirmAgenticPaystackDvaPayment,
  getPaystackDvaReceiverAccountNumber,
} from '@/lib/agentic/paystack-dva-webhook';
import { revalidateMerchantFeed } from '@/lib/cache-revalidation';
import { upsertPaystackAuthorization } from '@/lib/customer-saved-payment-methods';
import {
  createVerifiedPaystackWebhookSignature,
  handlePaystackSavingsWebhookTransaction,
} from '@/lib/customer-savings-paystack-webhook';
import {
  creditWalletTopUp,
  WALLET_TOP_UP_TRANSACTION_TYPE,
} from '@/lib/customer-wallet-top-up';
import {
  claimDomainFulfillment,
  getDomainRegistrationFailureMessage,
  hasDomainRegistrarProof,
  isTerminalDomainRegistrationFailure,
  markRegistrarAttempted,
  releaseDomainFulfillmentClaim,
} from '@/lib/domains/fulfillment-claim';
import { triggerDomainEdgeConfigSync } from '@/lib/edge-config-sync';
import {
  generateOrderConfirmationEmail,
  generateOrderConfirmationText,
} from '@/lib/email-templates';
import { notifyNewOrder, notifyPaymentReceived } from '@/lib/expo-push';
import { isGo54Configured, registerDomain } from '@/lib/go54';
import { verifyPayment as verifyKorapayPayment } from '@/lib/korapay';
import { logger } from '@/lib/logger';
import { confirmPaystackDvaByOrderAccount } from '@/lib/payments/confirm-paystack-dva-by-order-account';
import { confirmPaystackMerchantWalletDva } from '@/lib/payments/confirm-paystack-merchant-wallet-dva';
import { confirmPaystackWalletDvaTopUp } from '@/lib/payments/confirm-paystack-wallet-dva-top-up';
import { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';
import { isMerchantInvoicePartialBalanceReview } from '@/lib/payments/is-merchant-invoice-partial-balance-review';
import { processMerchantInvoicePartialPayment } from '@/lib/payments/process-merchant-invoice-partial-payment';
import { processWalletFundedOrderPayment } from '@/lib/payments/process-wallet-funded-order-payment';
import { recordOrderUpdateFailureSettlement } from '@/lib/payments/record-order-update-failure-settlement';
import { scheduleWalletTopUpCreditNotification } from '@/lib/payments/schedule-wallet-top-up-credit-notification';
import {
  calculatePlatformFee,
  verifyTransaction as verifyPaystackPayment,
} from '@/lib/paystack';
import { handlePaystackMerchantWalletAssignmentFailure } from '@/lib/paystack-merchant-wallet-assignment-failure-webhook';
import { handlePaystackMerchantWalletAssignmentSuccess } from '@/lib/paystack-merchant-wallet-assignment-success-webhook';
import { dispatchRepairPickupPayment } from '@/lib/repairs/dispatch-repair-pickup-payment';
import { sanitizeForLog } from '@/lib/sanitize-core';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { fulfillPendingVtuTransaction } from '@/lib/vtu-fulfillment';
import {
  extractMetadataField,
  isString,
  normalizeMetadata,
  scheduleVoucherPinBackfill,
} from '@/lib/vtu-voucher-backfill';
import { sendEmail } from '@/lib/zeptomail';
import {
  paystackZeroCandidateReviewGatewayResponseSchema,
  referenceSchema,
} from '@/schemas/payments';

type PaymentGateway = 'paystack' | 'korapay';

type VerifiedGatewayAmount = { amount: number; currency?: string };

interface PaymentTransactionRecord {
  amount: number | string | null;
  id: string;
  merchant_id: string;
  metadata: Record<string, unknown> | null;
}

function isRetryableDomainRegistrationFailure(error: unknown) {
  const message = getDomainRegistrationFailureMessage(error);

  if (isTerminalDomainRegistrationFailure(error)) {
    return false;
  }

  const retryablePatterns = [
    'bad gateway',
    'connection',
    'econn',
    'gateway timeout',
    'internal server',
    'network',
    'rate limit',
    'registrar unavailable',
    'service unavailable',
    'socket',
    'temporar',
    'timeout',
    'timed out',
    'too many requests',
    'try again',
  ];

  return retryablePatterns.some((pattern) => message.includes(pattern));
}

async function reconcileAgenticPaystackDvaSession({
  metadata,
  reference,
  supabase,
  transaction,
}: {
  metadata: Record<string, unknown> | null;
  reference: string;
  supabase: SupabaseClient;
  transaction: { merchant_id: string; order_id?: string | null };
}) {
  const agenticSessionPayment = await markAgenticPaystackDvaSessionPaid({
    gatewayReference: reference,
    supabase,
    transaction: {
      merchant_id: transaction.merchant_id,
      metadata,
      order_id: transaction.order_id ?? null,
    },
  });
  if (agenticSessionPayment.ok) {
    return null;
  }

  logger.error({
    message: 'Agentic checkout session reconciliation failed',
    reference,
    error: sanitizeForLog(agenticSessionPayment.error),
  });
  return NextResponse.json(
    { error: 'Agentic checkout session reconciliation failed' },
    { status: 500 }
  );
}

/**
 * Detect which payment gateway sent the webhook
 */
function detectGateway(headers: Headers): PaymentGateway {
  if (headers.get('x-paystack-signature')) {
    return 'paystack';
  }
  if (headers.get('x-korapay-signature')) {
    return 'korapay';
  }
  // Default to korapay for backwards compatibility
  return 'korapay';
}

const PAYSTACK_WEBHOOK_REVIEW_MESSAGE = 'Paystack webhook accepted for review';

function isRetryablePaystackVerificationFailure(code: string | undefined) {
  if (!code) {
    return true;
  }

  if (code === 'NETWORK_ERROR' || code === 'CONFIG_ERROR') {
    return true;
  }

  const statusMatch = /^HTTP_(\d+)$/.exec(code);
  if (!statusMatch) {
    return false;
  }

  const status = Number(statusMatch[1]);
  return status === 408 || status === 429 || status >= 500;
}

function acknowledgePaystackWebhookForReview(
  details: { message: string } & Record<string, unknown>
) {
  logger.warn({
    ...details,
    gateway: 'paystack',
  });
  return NextResponse.json({ message: PAYSTACK_WEBHOOK_REVIEW_MESSAGE });
}

function getVerifiedAmount(
  gateway: PaymentGateway,
  gatewayResponse: Record<string, unknown>
): VerifiedGatewayAmount | null {
  const rawAmount = gatewayResponse.amount;
  if (
    typeof rawAmount !== 'number' ||
    !Number.isFinite(rawAmount) ||
    rawAmount <= 0
  ) {
    return null;
  }

  const currency =
    typeof gatewayResponse.currency === 'string'
      ? gatewayResponse.currency
      : undefined;
  const amount = gateway === 'paystack' ? rawAmount / 100 : rawAmount;

  return { amount, currency };
}

const POSTGRES_UNIQUE_VIOLATION = '23505';
const SUPABASE_NO_ROWS_RETURNED = 'PGRST116';

function isSupabaseNoRowsError(error: unknown) {
  const supabaseError = error as {
    code?: string;
    details?: string | null;
    message?: string | null;
  } | null;
  if (supabaseError?.code !== SUPABASE_NO_ROWS_RETURNED) {
    return false;
  }
  const details = `${supabaseError.details ?? ''} ${
    supabaseError.message ?? ''
  }`;
  return /\b0 rows?\b/i.test(details);
}

async function filePaystackZeroCandidateReview({
  gatewayResponse,
  reference,
  receiverAccountNumber,
  supabase,
  verifiedAmount,
}: {
  gatewayResponse: Record<string, unknown>;
  reference: string;
  receiverAccountNumber: string | null;
  supabase: SupabaseClient;
  verifiedAmount: VerifiedGatewayAmount | null;
}): Promise<{ duplicate: boolean; ok: true } | { error: unknown; ok: false }> {
  const parsedGatewayResponse =
    paystackZeroCandidateReviewGatewayResponseSchema.safeParse(gatewayResponse);
  if (!parsedGatewayResponse.success) {
    logger.error({
      message: 'Invalid Paystack response for zero-candidate payment review',
      reference,
      error: parsedGatewayResponse.error.flatten(),
    });
    return { error: parsedGatewayResponse.error, ok: false };
  }

  const reviewGatewayResponse = parsedGatewayResponse.data;
  const reviewRow = {
    candidates: [],
    issue_type: 'payment_match_zero_candidates',
    metadata: {
      channel: reviewGatewayResponse.channel,
      currency: verifiedAmount?.currency ?? null,
      customer_email: reviewGatewayResponse.customer.email,
      paid_at: reviewGatewayResponse.paid_at,
      receiver_account_number: receiverAccountNumber,
      verified_amount: verifiedAmount?.amount ?? null,
    },
    paystack_ref: reference,
    reason:
      'Verified Paystack charge.success webhook did not match any local transaction, order payment account, wallet top-up, or chat order.',
  };

  const { error } = await supabase
    .from('reconciliation_review')
    .insert(reviewRow);
  if (!error) return { duplicate: false, ok: true };

  if ((error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION) {
    logger.info({
      message:
        'Paystack zero-candidate payment review already filed (expected webhook retry no-op)',
      reference,
    });
    return { duplicate: true, ok: true };
  }

  logger.error({
    message: 'Failed to file Paystack zero-candidate payment review',
    reference,
    error: sanitizeForLog(error),
  });
  return { error, ok: false };
}

async function handleWalletTopUpIfNeeded({
  gateway,
  reference,
  supabase,
  transaction,
}: {
  gateway: PaymentGateway;
  reference: string;
  supabase: SupabaseClient;
  transaction: PaymentTransactionRecord;
}) {
  const metadata = transaction.metadata ?? {};
  if (metadata.transaction_type !== WALLET_TOP_UP_TRANSACTION_TYPE) {
    return null;
  }

  if (typeof metadata.customer_id !== 'string') {
    logger.error({
      message: 'Wallet top-up metadata missing customer id',
      reference,
      transactionId: transaction.id,
    });
    return NextResponse.json(
      { error: 'Wallet top-up customer not found' },
      { status: 400 }
    );
  }
  const customerId = metadata.customer_id;

  const amount = Number(transaction.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    logger.error({
      message: 'Wallet top-up transaction has invalid amount',
      amount: transaction.amount,
      reference,
      transactionId: transaction.id,
    });
    return NextResponse.json(
      { error: 'Invalid wallet top-up amount' },
      { status: 400 }
    );
  }

  let walletCredit: Awaited<ReturnType<typeof creditWalletTopUp>>;
  try {
    walletCredit = await creditWalletTopUp({
      amount,
      customerId: metadata.customer_id,
      gateway,
      merchantId: transaction.merchant_id,
      reference,
      supabase,
      transactionId: transaction.id,
    });
  } catch (error) {
    logger.error({
      message: 'Wallet top-up credit failed',
      customerId: metadata.customer_id,
      error,
      gateway,
      reference,
      transactionId: transaction.id,
    });
    return NextResponse.json(
      { error: 'Failed to credit wallet top-up' },
      { status: 500 }
    );
  }

  // Notify the customer of the credit off the response path. `after` runs on the
  // async runtime so a push can never block or alter the 2xx ack, and gating on
  // `firstCredit` keeps webhook retries from double-notifying. The same helper
  // runs in the wallet top-up CONFIRM route, so whichever of the two racing
  // callers actually takes the first credit is the one that notifies — exactly
  // one push either way.
  scheduleWalletTopUpCreditNotification({
    amount,
    customerId,
    firstCredit: walletCredit.firstCredit,
    merchantId: transaction.merchant_id,
    metadata,
    reference,
    scheduleAfter: after,
    transactionId: transaction.id,
  });

  return NextResponse.json({
    message: 'Wallet top-up credited',
    reference: walletCredit.reference,
    wallet: {
      balance: walletCredit.balance,
    },
  });
}

async function handleWalletFundedOrderPaymentIfNeeded({
  gateway,
  gatewayResponse,
  reference,
  supabase,
  transaction,
}: {
  gateway: PaymentGateway;
  gatewayResponse: Record<string, unknown>;
  reference: string;
  supabase: SupabaseClient;
  transaction: PaymentTransactionRecord;
}) {
  if (gateway !== 'paystack') {
    return null;
  }

  const result = await processWalletFundedOrderPayment({
    gatewayReference: reference,
    gatewayResponse,
    scheduleAfter: (task) => after(task),
    supabase,
    transaction,
  });

  if (result.kind === 'none') {
    return null;
  }

  return NextResponse.json(result.body, { status: result.status });
}

function ensureWalletFundedOrderHandled({
  gateway,
  gatewayResponse,
  reference,
  supabase,
  transaction,
}: {
  gateway: PaymentGateway;
  gatewayResponse: Record<string, unknown>;
  reference: string;
  supabase: SupabaseClient;
  transaction: Pick<
    AgenticPaystackDvaTransaction,
    'amount' | 'id' | 'merchant_id' | 'metadata'
  >;
}) {
  return handleWalletFundedOrderPaymentIfNeeded({
    gateway,
    gatewayResponse,
    reference,
    supabase,
    transaction: {
      amount: transaction.amount,
      id: transaction.id,
      merchant_id: transaction.merchant_id,
      metadata: transaction.metadata,
    },
  });
}

/**
 * Verify Korapay webhook signature
 * @param signature - The signature from the x-korapay-signature header
 * @param payload - The raw request body as string
 * @returns boolean indicating if signature is valid
 */
function verifyKorapayWebhookSignature(
  signature: string | null,
  payload: string
): boolean {
  if (!signature) {
    logger.warn({ message: 'Korapay webhook signature missing' });
    return false;
  }

  const secretKey = process.env.KORAPAY_SECRET_KEY;
  if (!secretKey) {
    logger.error({ message: 'KORAPAY_SECRET_KEY not configured' });
    return false;
  }

  try {
    const signatureHex = String(signature).toLowerCase();
    let expectedKorapaySignature: string | null = null;

    // Korapay currently signs ONLY the `data` object with HMAC-SHA256.
    // Keep a legacy fallback for existing integrations that may still sign
    // the full payload with SHA512.
    try {
      const parsedPayload = JSON.parse(payload) as {
        data?: Record<string, unknown>;
      };
      const dataPayload = parsedPayload.data;

      expectedKorapaySignature =
        dataPayload && typeof dataPayload === 'object'
          ? createHmac('sha256', secretKey)
              .update(JSON.stringify(dataPayload))
              .digest('hex')
          : null;
    } catch {
      expectedKorapaySignature = null;
    }

    if (
      expectedKorapaySignature &&
      verifyWebhookSignature(signatureHex, expectedKorapaySignature)
    ) {
      return true;
    }

    const legacySignature = createHmac('sha512', secretKey)
      .update(payload)
      .digest('hex');

    const isLegacyMatch = verifyWebhookSignature(signatureHex, legacySignature);
    if (isLegacyMatch) {
      logger.warn({
        message:
          'Korapay webhook matched legacy SHA512 payload signature. Please use SHA256 over payload.data.',
      });
    }

    return isLegacyMatch;
  } catch (error) {
    logger.error({
      message: 'Korapay webhook signature verification error',
      error,
    });
    return false;
  }
}

/**
 * Verify Paystack webhook signature
 * @param signature - The signature from the x-paystack-signature header
 * @param payload - The raw request body as string
 * @returns boolean indicating if signature is valid
 */
function verifyPaystackWebhookSignature(
  signature: string | null,
  payload: string
): boolean {
  if (!signature) {
    logger.warn({ message: 'Paystack webhook signature missing' });
    return false;
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    logger.error({ message: 'PAYSTACK_SECRET_KEY not configured' });
    return false;
  }

  try {
    // Generate expected signature using HMAC-SHA512
    const expectedSignature = createHmac('sha512', secretKey)
      .update(payload)
      .digest('hex');
    return verifyWebhookSignature(
      String(signature).toLowerCase(),
      expectedSignature
    );
  } catch (error) {
    logger.error({
      message: 'Paystack webhook signature verification error',
      error,
    });
    return false;
  }
}

function verifyWebhookSignature(
  providedSignature: string,
  expectedSignature: string
): boolean {
  try {
    const signatureBuffer = Buffer.from(providedSignature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Detect which gateway sent the webhook
    const gateway = detectGateway(request.headers);

    // Get raw body for signature verification
    const rawBody = await request.text();

    // Verify webhook signature based on gateway
    let isValidSignature = false;
    if (gateway === 'paystack') {
      const signature = request.headers.get('x-paystack-signature');
      isValidSignature = verifyPaystackWebhookSignature(signature, rawBody);
    } else {
      const signature = request.headers.get('x-korapay-signature');
      isValidSignature = verifyKorapayWebhookSignature(signature, rawBody);
    }

    if (!isValidSignature) {
      logger.warn({
        message: `Invalid ${gateway} webhook signature`,
        gateway,
      });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // 2026 Critical Fix: Parse the verified payload with error handling
    // Even with valid signature, malformed JSON could crash the webhook
    // Define expected webhook payload structure
    interface WebhookPayload {
      event?: string;
      status?: string;
      reference?: string;
      data?: {
        reference?: string;
        status?: string;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    }

    let body: WebhookPayload;
    try {
      body = JSON.parse(rawBody) as WebhookPayload;
    } catch (parseError) {
      logger.error({
        message: 'Failed to parse webhook JSON body',
        gateway,
        error:
          parseError instanceof Error
            ? parseError.message
            : 'Unknown parse error',
        rawBodyPreview: rawBody.substring(0, 200), // Log first 200 chars for debugging
      });
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    logger.info({
      message: `Payment webhook received from ${gateway} (signature verified)`,
      gateway,
      event: body.event,
    });

    if (
      gateway === 'paystack' &&
      (body.event === 'dedicatedaccount.assign.success' ||
        body.event === 'dedicatedaccount.assign.failed')
    ) {
      if (body.event === 'dedicatedaccount.assign.failed') {
        return handlePaystackMerchantWalletAssignmentFailure(
          createServiceClient(),
          body as unknown as Record<string, unknown>
        );
      }
      return handlePaystackMerchantWalletAssignmentSuccess(
        createServiceClient(),
        body as unknown as Record<string, unknown>
      );
    }

    // Extract reference and check event type based on gateway
    let reference: string;
    let isSuccessEvent = false;

    if (gateway === 'paystack') {
      // Paystack webhook structure: { event: 'charge.success', data: { reference, ... } }
      const event = body.event;
      reference = body.data?.reference ?? '';

      isSuccessEvent = event === 'charge.success';

      if (!isSuccessEvent) {
        logger.info({
          message: 'Ignoring non-success Paystack webhook event',
          reference,
          event,
        });
        return NextResponse.json({ message: 'Event ignored' });
      }
    } else {
      // Korapay webhook structure can place the reference either at the top
      // level or nested in data.reference, depending on event type/version.
      reference = body.reference ?? body.data?.reference ?? '';
      const event = body.event;
      const status = body.status ?? body.data?.status;

      isSuccessEvent = event === 'charge.success' || status === 'success';

      if (!isSuccessEvent) {
        logger.info({
          message: 'Ignoring non-success Korapay webhook event',
          reference,
          event,
          status,
        });
        return NextResponse.json({ message: 'Event ignored' });
      }
    }

    // Input validation - intentional guard, not a bypass
    // This reference is used to look up server-side transaction records,
    // which are then verified against the payment gateway.
    // lgtm[js/user-controlled-bypass]
    // codeql[js/user-controlled-bypass-of-security-check]
    const referenceResult = referenceSchema.safeParse(reference);

    if (!referenceResult.success) {
      if (gateway === 'paystack') {
        return acknowledgePaystackWebhookForReview({
          message: 'Paystack webhook has invalid reference',
          event: body.event,
        });
      }

      return NextResponse.json({ error: 'Invalid reference' }, { status: 400 });
    }
    const safeReference = referenceResult.data;
    reference = safeReference;

    // Webhook handlers have no user cookies — use service client to bypass RLS
    const supabase = createServiceClient();

    // Verify payment with the appropriate gateway
    let paymentStatus: string;
    let gatewayResponse: Record<string, unknown>;

    if (gateway === 'paystack') {
      const result = await verifyPaystackPayment(safeReference);
      if (!result.success) {
        if (isRetryablePaystackVerificationFailure(result.code)) {
          logger.warn({
            message: 'Paystack webhook verification failed transiently',
            gateway,
            reference,
            code: result.code,
            error: sanitizeForLog(result.error),
          });
          return NextResponse.json(
            { error: 'Paystack verification temporarily unavailable' },
            { status: 503 }
          );
        }

        return acknowledgePaystackWebhookForReview({
          message:
            'Paystack webhook verification failed with non-retryable result',
          reference,
          code: result.code,
          error: sanitizeForLog(result.error),
        });
      }
      paymentStatus = result.data.status;
      gatewayResponse = result.data as unknown as Record<string, unknown>;
    } else {
      const result = await verifyKorapayPayment(safeReference);
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      paymentStatus = result.data.status;
      gatewayResponse = result.data as unknown as Record<string, unknown>;
    }

    if (paymentStatus !== 'success') {
      if (gateway === 'paystack') {
        return acknowledgePaystackWebhookForReview({
          message: 'Paystack webhook verification returned non-success status',
          reference,
          status: paymentStatus,
        });
      }

      logger.warn({
        message: 'Payment verification failed',
        reference,
        gateway,
        status: paymentStatus,
      });
      return NextResponse.json(
        { error: 'Payment not successful' },
        { status: 400 }
      );
    }

    const verifiedAmount = getVerifiedAmount(gateway, gatewayResponse);

    if (
      (gateway === 'paystack' || gateway === 'korapay') &&
      verifiedAmount === null
    ) {
      logger.error({
        gateway,
        message: 'Payment webhook missing verified amount',
        reference,
      });
      return NextResponse.json(
        { error: 'Payment amount verification failed' },
        { status: 422 }
      );
    }

    if (verifiedAmount) {
      const repairPickupPayment = await dispatchRepairPickupPayment({
        gateway,
        gatewayResponse,
        reference,
        supabase,
        verifiedAmount: verifiedAmount.amount,
      });
      if (repairPickupPayment) {
        return repairPickupPayment;
      }
    }

    let resolvedAgenticTransaction: AgenticPaystackDvaTransaction | null = null;
    if (gateway === 'paystack') {
      const receiverAccountNumber = getPaystackDvaReceiverAccountNumber(body);

      const agenticDvaPayment = await confirmAgenticPaystackDvaPayment({
        accountNumber: receiverAccountNumber,
        gatewayReference: reference,
        supabase,
        verifiedAmount,
      });

      if (agenticDvaPayment.handled) {
        return NextResponse.json(agenticDvaPayment.body, {
          status: agenticDvaPayment.status,
        });
      }
      resolvedAgenticTransaction = agenticDvaPayment.transaction ?? null;

      // B1 (Δ-3, Δ-6, Δ-10, Δ-55, Δ-57): if the agentic checkout-session
      // path didn't match, try the regular DVA path — match against the
      // persisted `order_payment_accounts` row(s) using B0's 6-key
      // tighten. On single match, insert a pending `transactions` row
      // so the webhook's normal flow flips it to completed and runs
      // side effects via the A1 outbox. Ambiguous matches file a
      // `reconciliation_review` row and return 409.
      if (!resolvedAgenticTransaction) {
        const merchantWalletDva = await confirmPaystackMerchantWalletDva({
          supabase,
          accountNumber: receiverAccountNumber,
          gatewayReference: reference,
          verifiedAmount,
          paystackResponse: gatewayResponse,
        });
        if (merchantWalletDva.kind === 'review') {
          return NextResponse.json(merchantWalletDva.body, {
            status: merchantWalletDva.status,
          });
        }
        if (merchantWalletDva.kind === 'match') {
          return NextResponse.json({
            success: true,
            balance: merchantWalletDva.balance,
            firstCredit: merchantWalletDva.firstCredit,
          });
        }
      }

      if (!resolvedAgenticTransaction) {
        const orderAccountResult = await confirmPaystackDvaByOrderAccount({
          supabase,
          accountNumber: receiverAccountNumber,
          gatewayReference: reference,
          verifiedAmount,
          paystackResponse: gatewayResponse,
        });
        if (orderAccountResult.kind === 'review') {
          return NextResponse.json(orderAccountResult.body, {
            status: orderAccountResult.status,
          });
        }
        if (orderAccountResult.kind === 'error') {
          return NextResponse.json(orderAccountResult.body, {
            status: orderAccountResult.status,
          });
        }
        if (orderAccountResult.kind === 'match') {
          resolvedAgenticTransaction =
            orderAccountResult.transaction as AgenticPaystackDvaTransaction;
        }
      }

      if (!resolvedAgenticTransaction) {
        const walletDvaTopUp = await confirmPaystackWalletDvaTopUp({
          supabase,
          accountNumber: receiverAccountNumber,
          gatewayReference: reference,
          verifiedAmount,
          paystackResponse: gatewayResponse,
        });

        if (walletDvaTopUp.kind === 'review') {
          return NextResponse.json(walletDvaTopUp.body, {
            status: walletDvaTopUp.status,
          });
        }

        if (walletDvaTopUp.kind === 'match') {
          resolvedAgenticTransaction = walletDvaTopUp.transaction;
        }
      }
    }

    // ============================================
    // CHAT ORDER HANDLING (Virtual Account Payments)
    // 2026 Best Practice: Unified Order Flow
    // Chat orders are now converted to standard orders on payment
    // ============================================
    if (reference.startsWith('CHAT-')) {
      logger.info({
        message: 'Processing chat order payment - unified flow',
        reference,
        gateway,
      });

      // Find the chat order
      const { data: chatOrder, error: chatOrderError } = await supabase
        .from('chat_orders')
        .select(
          'id, merchant_id, customer_id, customer_name, customer_email, customer_phone, shipping_address, session_id, subtotal, shipping_fee, items, status'
        )
        .eq('payment_reference', reference)
        .single();

      if (chatOrderError || !chatOrder) {
        logger.warn({
          message: 'Chat order not found for payment reference',
          reference,
          error: chatOrderError,
        });
        // Don't fail - might be a regular order with CHAT prefix by coincidence
        // Fall through to standard order handling
      } else {
        if (chatOrder.status === 'completed' || chatOrder.status === 'paid') {
          // Find the order number for response
          const { data: existingOrder } = await supabase
            .from('orders')
            .select('id, order_number')
            .eq(
              'notes',
              `Converted from chat order. Session: ${chatOrder.session_id}`
            )
            .maybeSingle();

          logger.info({
            message:
              'Chat order already converted and processed (idempotent check)',
            reference,
            chatOrderId: chatOrder.id,
            orderId: existingOrder?.id,
          });

          return NextResponse.json({
            success: true,
            message: 'Already processed',
            orderId: existingOrder?.id || null,
            orderNumber: existingOrder?.order_number || null,
          });
        }

        const amountValue = verifiedAmount?.amount ?? 0;
        const currencyValue = verifiedAmount?.currency ?? 'NGN';

        logger.info({
          message:
            'Executing convert_chat_order_to_paid_order_with_inventory RPC',
          chatOrderId: chatOrder.id,
          reference,
          amount: amountValue,
          currency: currencyValue,
        });

        const { data: convertRes, error: convertError } = await supabase.rpc(
          'convert_chat_order_to_paid_order_with_inventory',
          {
            p_chat_order_id: chatOrder.id,
            p_gateway: gateway,
            p_reference: reference,
            p_amount: amountValue,
            p_currency: currencyValue,
          }
        );

        if (convertError) {
          logger.error({
            message:
              'Failed to convert chat order to paid order with inventory',
            reference,
            chatOrderId: chatOrder.id,
            error: convertError,
          });

          if (
            convertError.message?.includes(
              'serialized_inventory_unavailable'
            ) ||
            convertError.code === '55000'
          ) {
            return NextResponse.json(
              {
                error: 'serialized_inventory_unavailable',
                code: 'serialized_inventory_unavailable',
              },
              { status: 409 }
            );
          }

          return NextResponse.json(
            { error: convertError.message || 'Failed to convert chat order' },
            { status: 500 }
          );
        }

        const result = convertRes as {
          success: boolean;
          order_id: string;
          order_number: string;
          already_processed: boolean;
        };

        if (!result.success) {
          logger.error({
            message: 'Chat order conversion returned unsuccessful result',
            reference,
            chatOrderId: chatOrder.id,
            result,
          });
          return NextResponse.json(
            { error: 'Failed to convert chat order' },
            { status: 500 }
          );
        }

        if (result.already_processed) {
          logger.info({
            message: 'Chat order already converted and processed',
            reference,
            chatOrderId: chatOrder.id,
            orderId: result.order_id,
          });
          return NextResponse.json({
            success: true,
            message: 'Already processed',
            orderId: result.order_id,
            orderNumber: result.order_number,
          });
        }

        const newOrderId = result.order_id;
        const orderNumber = result.order_number;

        // Send push notification to merchant (non-blocking)
        after(async () => {
          const orderAmount =
            (Number(chatOrder.subtotal) || 0) +
            (Number(chatOrder.shipping_fee) || 0);

          try {
            await notifyNewOrder(
              chatOrder.merchant_id,
              newOrderId,
              orderNumber,
              chatOrder.customer_name || 'Customer',
              orderAmount,
              'NGN'
            );
          } catch (pushErr) {
            logger.warn({
              message: 'New order push notification failed for chat order',
              error: pushErr,
            });
          }

          try {
            await notifyPaymentReceived(
              chatOrder.merchant_id,
              orderAmount,
              'NGN',
              orderNumber,
              newOrderId
            );
          } catch (pushErr) {
            logger.warn({
              message:
                'Payment received push notification failed for chat order',
              error: pushErr,
            });
          }
        });

        // Parse items from JSONB
        const chatItems = (chatOrder.items || []) as Array<{
          product_id: string;
          variant_id?: string;
          name: string;
          quantity: number;
          price: number;
          image_url?: string;
        }>;

        // Send order confirmation email
        try {
          const { data: merchantDetails } = await supabase
            .from('merchants')
            .select(
              'business_name, slug, support_email, email_sender_name, email, tax_identification_number, cac_rc_number'
            )
            .eq('id', chatOrder.merchant_id)
            .single();

          if (merchantDetails && chatOrder.customer_email) {
            const rootDomain =
              process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com';
            const merchantUrl = `https://${merchantDetails.slug}.${rootDomain}`;

            const emailItems = chatItems.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              price: item.price,
            }));

            const shippingAddr = chatOrder.shipping_address as {
              address?: string;
              city?: string;
              state?: string;
            } | null;

            const emailData = {
              orderNumber,
              customerName: chatOrder.customer_name || 'Customer',
              items: emailItems,
              subtotal: Number(chatOrder.subtotal),
              shippingFee: Number(chatOrder.shipping_fee || 0),
              total:
                Number(chatOrder.subtotal) +
                Number(chatOrder.shipping_fee || 0),
              // Chat orders are an NGN-only rail: the conversion RPC rejects
              // any non-NGN payment, so the email currency is fixed.
              currency: 'NGN',
              shippingAddress: {
                address: shippingAddr?.address || '',
                city: shippingAddr?.city || '',
                state: shippingAddr?.state || '',
                phone: chatOrder.customer_phone || '',
              },
              merchantName: merchantDetails.business_name,
              merchantUrl,
              merchantTin:
                merchantDetails.tax_identification_number ?? undefined,
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

            await sendEmail({
              to: chatOrder.customer_email,
              toName: chatOrder.customer_name || 'Customer',
              subject: `Order Confirmation - #${orderNumber}`,
              htmlContent,
              textContent,
              replyTo: replyToEmail,
              emailType: 'orders',
              fromName: senderName,
              auditContext: {
                merchantId: chatOrder.merchant_id,
                orderId: newOrderId,
                customerId: chatOrder.customer_id || null,
                metadata: {
                  trigger: 'paystack_chat_order_confirmation',
                  chatOrderId: chatOrder.id,
                },
              },
            });

            logger.info({
              message: 'Chat order confirmation email sent',
              orderId: newOrderId,
            });
          }
        } catch (emailErr) {
          logger.warn({
            message: 'Email failed for chat order',
            error: emailErr,
          });
        }

        // Record settlement for merchant wallet
        try {
          const grossAmount = Number(chatOrder.subtotal) || 0;
          const platformFee =
            calculatePlatformFee(grossAmount * 100).platformFee / 100;

          await supabase.rpc('record_merchant_settlement', {
            p_merchant_id: chatOrder.merchant_id,
            p_source_type: 'order',
            p_source_id: newOrderId,
            p_gateway: gateway,
            p_gateway_reference: reference,
            p_gross_amount: grossAmount,
            p_gateway_fee: 0,
            p_platform_fee: platformFee,
            p_description: `Chat order payment via ${gateway}`,
            // Δ-29 / Δ-59: traceability — gateway-side ref lives in metadata
            // only (chat-order path has no separate BAC-* yet). Review
            // feedback: key is gateway-prefixed, not hardcoded paystack.
            p_metadata: { [`${gateway}_reference`]: reference },
          });
        } catch (settlementErr) {
          logger.warn({
            message: 'Settlement recording failed for chat order',
            error: settlementErr,
          });
        }

        logger.info({
          message: 'Chat order converted to standard order successfully',
          chatOrderId: chatOrder.id,
          newOrderId,
          orderNumber,
          reference,
        });

        return NextResponse.json({
          success: true,
          message:
            'Chat order payment processed and converted to standard order',
          orderId: newOrderId,
          orderNumber,
        });
      }
    }

    // ============================================
    // STANDARD ORDER HANDLING
    // ============================================

    let transaction: AgenticPaystackDvaTransaction | null =
      resolvedAgenticTransaction;
    let transactionError: unknown = null;

    if (!transaction) {
      const transactionResult = await supabase
        .from('transactions')
        .select(AGENTIC_PAYSTACK_DVA_TRANSACTION_SELECT)
        .eq('gateway_reference', reference)
        .single();
      transaction = transactionResult.data
        ? normalizeAgenticPaystackDvaTransaction(transactionResult.data)
        : null;
      transactionError = transactionResult.error;
    }

    if (transactionError && !isSupabaseNoRowsError(transactionError)) {
      logger.error({
        message: 'Transaction lookup failed',
        reference,
        error: sanitizeForLog(transactionError),
      });
      return NextResponse.json(
        { error: 'Transaction lookup failed' },
        { status: 500 }
      );
    }

    if (!transaction) {
      if (gateway === 'paystack') {
        const reviewResult = await filePaystackZeroCandidateReview({
          gatewayResponse,
          reference,
          receiverAccountNumber: getPaystackDvaReceiverAccountNumber(body),
          supabase,
          verifiedAmount,
        });
        if (!reviewResult.ok) {
          return NextResponse.json(
            { error: 'Payment reconciliation review unavailable' },
            { status: 500 }
          );
        }

        logger.warn({
          message:
            'Paystack webhook acknowledged with zero local payment candidates',
          reference,
          duplicateReview: reviewResult.duplicate,
        });
        return NextResponse.json({
          code: 'PAYSTACK_PAYMENT_MATCH_ZERO_CANDIDATES',
          message: 'Paystack webhook accepted for reconciliation review',
        });
      }

      logger.error({
        message: 'Transaction not found',
        reference,
        error: transactionError,
      });
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }

    const metadata = transaction.metadata as Record<string, unknown>;

    if (verifiedAmount) {
      const transactionAmount = Number(transaction.amount) || 0;
      const expectedCurrency =
        typeof transaction.currency === 'string' ? transaction.currency : null;

      if (Math.abs(verifiedAmount.amount - transactionAmount) > 0.01) {
        logger.error({
          message: 'Payment amount mismatch',
          reference,
          gateway,
          expected: transactionAmount,
          received: verifiedAmount.amount,
          currency: verifiedAmount.currency,
        });
        return NextResponse.json(
          { error: 'Payment amount mismatch' },
          { status: 400 }
        );
      }

      if (
        expectedCurrency &&
        verifiedAmount.currency &&
        expectedCurrency.toUpperCase() !== verifiedAmount.currency.toUpperCase()
      ) {
        logger.error({
          message: 'Payment currency mismatch',
          reference,
          gateway,
          expected: expectedCurrency,
          received: verifiedAmount.currency,
        });
        return NextResponse.json(
          { error: 'Payment currency mismatch' },
          { status: 400 }
        );
      }
    } else {
      logger.warn({
        message: 'Could not verify payment amount',
        reference,
        gateway,
      });
    }

    const merchantInvoicePartialPayment =
      await processMerchantInvoicePartialPayment({
        gateway,
        gatewayResponse,
        reference,
        supabase,
        transaction,
      });
    if (merchantInvoicePartialPayment.kind !== 'none') {
      return NextResponse.json(merchantInvoicePartialPayment.body, {
        status: merchantInvoicePartialPayment.status,
      });
    }

    // Atomically claim the transaction — prevents double-processing on concurrent retries
    const { data: updatedTxn, error: updateError } = await supabase
      .from('transactions')
      .update({
        status: 'completed',
        gateway_response: gatewayResponse,
        updated_at: new Date().toISOString(),
      })
      .eq('id', transaction.id)
      .neq('status', 'completed')
      .select('id')
      .maybeSingle();

    if (updateError) {
      logger.error({
        message: 'Failed to update transaction',
        reference,
        error: updateError,
      });
      throw updateError;
    }

    if (!updatedTxn) {
      const walletFundedOrderResponse = await ensureWalletFundedOrderHandled({
        gateway,
        gatewayResponse,
        reference,
        supabase,
        transaction,
      });

      if (walletFundedOrderResponse) {
        return walletFundedOrderResponse;
      }

      const walletTopUpResponse = await handleWalletTopUpIfNeeded({
        gateway,
        reference,
        supabase,
        transaction: {
          amount: transaction.amount,
          id: transaction.id,
          merchant_id: transaction.merchant_id,
          metadata,
        },
      });

      if (walletTopUpResponse) {
        return walletTopUpResponse;
      }

      if (gateway === 'paystack') {
        const savingsResponse = await handlePaystackSavingsWebhookTransaction({
          gatewayResponse,
          paystackSignature:
            createVerifiedPaystackWebhookSignature(isValidSignature),
          reference,
          supabase,
          transaction: {
            amount: transaction.amount,
            id: transaction.id,
            merchant_id: transaction.merchant_id,
            metadata,
          },
        });
        if (savingsResponse) {
          return NextResponse.json(savingsResponse.body, {
            status: savingsResponse.status,
          });
        }
      }

      if (
        metadata?.transaction_type === 'vtu_purchase' &&
        typeof metadata.vtu_transaction_id === 'string'
      ) {
        const fulfillment = await fulfillPendingVtuTransaction({
          supabase,
          transactionId: metadata.vtu_transaction_id,
        });

        return NextResponse.json({
          message:
            fulfillment.status === 'successful'
              ? 'VTU fulfillment already completed'
              : 'VTU fulfillment already in progress',
        });
      }

      // Domain purchases: payment completion and registrar fulfillment are
      // separate steps — a retry for a completed-but-unfulfilled purchase must
      // still fulfill (claim-serialized; no-op once domain_purchased is set).
      const domainRetryResponse = await fulfillDomainPurchase();
      if (domainRetryResponse) {
        return domainRetryResponse;
      }

      logger.info({ message: 'Transaction already processed', reference });
      if (transaction.order_id) {
        // A completed transaction does NOT guarantee the order flip landed:
        // the July 2026 incident (ORD-260711-00NT-5) wedged exactly here —
        // the order update crashed after the flip and every redelivery
        // short-circuited to 200. Run the shared finalizer unconditionally:
        // it heals wedged orders, drains missed side effects, and files the
        // cancelled/refunded reconciliation reviews idempotently (a crash
        // between the flip and finalization followed by a cancellation must
        // still leave a durable review row).
        const finalizeOutcome = await finalizeOrderGatewayPayment({
          actor: `webhook:${reference}`,
          gateway,
          gatewayResponse,
          orderId: transaction.order_id,
          reference,
          scheduleAfter: (task) => after(task),
          supabase,
          transaction: {
            amount: transaction.amount,
            gateway_reference: transaction.gateway_reference ?? null,
            id: transaction.id,
            merchant_id: transaction.merchant_id,
            order_id: transaction.order_id,
            platform_fee: transaction.platform_fee,
          },
          wonTransactionFlip: false,
        });

        if (finalizeOutcome.kind === 'inventory_failed') {
          return NextResponse.json(finalizeOutcome.payload, {
            status: finalizeOutcome.status,
          });
        }
        if (
          finalizeOutcome.kind === 'completion_failed' &&
          isMerchantInvoicePartialBalanceReview(finalizeOutcome.error)
        ) {
          return NextResponse.json(
            {
              code: 'MERCHANT_INVOICE_PARTIAL_BALANCE_CHANGED',
              error: 'Payment requires reconciliation review',
            },
            { status: 409 }
          );
        }
        if (
          finalizeOutcome.kind === 'completion_failed' ||
          finalizeOutcome.kind === 'order_fetch_failed' ||
          finalizeOutcome.kind === 'inventory_cleanup_failed' ||
          // Captured money on an order that must not reopen, with no ops
          // trail: never ack, or the gateway stops redelivering.
          finalizeOutcome.kind === 'review_failed'
        ) {
          logger.error({
            message: 'Webhook redelivery failed to heal order payment',
            orderId: transaction.order_id,
            outcome: finalizeOutcome.kind,
            reference,
          });
          return NextResponse.json(
            { error: 'Order payment completion failed' },
            { status: 500 }
          );
        }
        if (finalizeOutcome.kind === 'completed' && finalizeOutcome.healed) {
          logger.warn({
            message: 'Webhook redelivery healed a wedged order payment',
            orderId: transaction.order_id,
            reference,
          });
        }
        // 'order_cancelled' / 'order_skipped' fall through to the ack: the
        // reconciliation review is filed inside the finalizer.
      }
      if (gateway === 'paystack') {
        const reconciliationFailure = await reconcileAgenticPaystackDvaSession({
          metadata,
          reference,
          supabase,
          transaction: {
            merchant_id: transaction.merchant_id,
            order_id: transaction.order_id,
          },
        });
        if (reconciliationFailure) {
          return reconciliationFailure;
        }
      }
      return NextResponse.json({ message: 'Already processed' });
    }

    const walletFundedOrderResponse = await ensureWalletFundedOrderHandled({
      gateway,
      gatewayResponse,
      reference,
      supabase,
      transaction,
    });

    if (walletFundedOrderResponse) {
      return walletFundedOrderResponse;
    }

    const walletTopUpResponse = await handleWalletTopUpIfNeeded({
      gateway,
      reference,
      supabase,
      transaction: {
        amount: transaction.amount,
        id: transaction.id,
        merchant_id: transaction.merchant_id,
        metadata,
      },
    });

    if (walletTopUpResponse) {
      return walletTopUpResponse;
    }

    if (gateway === 'paystack') {
      const savingsResponse = await handlePaystackSavingsWebhookTransaction({
        gatewayResponse,
        paystackSignature:
          createVerifiedPaystackWebhookSignature(isValidSignature),
        reference,
        supabase,
        transaction: {
          amount: transaction.amount,
          id: transaction.id,
          merchant_id: transaction.merchant_id,
          metadata,
        },
      });
      if (savingsResponse) {
        return NextResponse.json(savingsResponse.body, {
          status: savingsResponse.status,
        });
      }
    }

    if (
      gateway === 'paystack' &&
      typeof metadata?.customer_id === 'string' &&
      typeof metadata?.customer_email === 'string' &&
      typeof gatewayResponse.authorization === 'object' &&
      gatewayResponse.authorization
    ) {
      try {
        await upsertPaystackAuthorization({
          supabase,
          merchantId: transaction.merchant_id,
          customerId: metadata.customer_id,
          customerEmail: metadata.customer_email,
          authorization: gatewayResponse.authorization as Parameters<
            typeof upsertPaystackAuthorization
          >[0]['authorization'],
        });
      } catch (authorizationError) {
        logger.warn({
          message: 'Failed to persist reusable Paystack authorization',
          error:
            authorizationError instanceof Error
              ? authorizationError.message
              : String(authorizationError),
          reference,
        });
      }
    }

    if (
      metadata?.transaction_type === 'vtu_purchase' &&
      typeof metadata.vtu_transaction_id === 'string'
    ) {
      const vtuTransactionId = metadata.vtu_transaction_id;
      const fulfillment = await fulfillPendingVtuTransaction({
        supabase,
        transactionId: vtuTransactionId,
      });

      if (fulfillment.status === 'processing') {
        after(async () => {
          try {
            const { data: vtuTx, error: vtuTxError } = await supabase
              .from('vtu_transactions')
              .select(
                'id, created_at, type, status, amount, network_provider, phone_number, biller_name, biller_item_code, customer_identifier, customer_name, request_reference, transaction_id, error_message, customer_cashback, metadata'
              )
              .eq('id', vtuTransactionId)
              .single();

            if (vtuTx && !vtuTxError) {
              const txMetadata = normalizeMetadata(vtuTx.metadata);
              const voucherPin = extractMetadataField(
                txMetadata,
                'voucherPin',
                isString
              );
              await scheduleVoucherPinBackfill({
                metadata: txMetadata,
                originalMetadata: vtuTx.metadata,
                supabase,
                transaction: vtuTx,
                voucherPin,
              });
            }
          } catch (err) {
            console.error(
              'Failed to trigger background backfill in webhook/route.ts:',
              err
            );
          }
        });
      } else if (fulfillment.status !== 'successful') {
        console.error('VTU fulfillment failed after payment', {
          transactionId: vtuTransactionId,
          status: fulfillment.status,
          reference: fulfillment.reference,
        });
      }

      return NextResponse.json({
        message:
          fulfillment.status === 'successful'
            ? 'VTU payment fulfilled'
            : fulfillment.status === 'processing'
              ? 'VTU payment pending fulfillment'
              : 'VTU fulfillment failed — requires manual review',
      });
    }

    // ============================================
    // DOMAIN PURCHASE FULFILLMENT
    // ============================================
    // Hoisted local function so BOTH paths can fulfill: the fresh completion
    // path below, and the already-completed path earlier — a completed-but-
    // unfulfilled purchase (the dashboard callback completed the payment then
    // died, or a prior delivery 500'd on a claim-write error) must still be
    // fulfilled by webhook retries. Never re-enters for an already-fulfilled
    // purchase (domain_purchased set), and the atomic claim serializes
    // concurrent callers.
    async function fulfillDomainPurchase(): Promise<NextResponse | null> {
      // Re-assert the outer null-guard: closures do not inherit narrowing.
      if (!transaction) {
        return null;
      }
      if (
        !(
          metadata?.transaction_type === 'domain_purchase' &&
          typeof metadata.domain === 'string'
        )
      ) {
        return null;
      }

      if (metadata.domain_purchased) {
        // Already fulfilled — the registrar is NEVER re-contacted. But if the
        // post-registration domains-row write failed, retries land here with
        // a registered domain that is invisible to Baci: repair the row from
        // the transaction metadata instead of stranding it.
        const repairedDomain = String(metadata.domain_purchased).toLowerCase();
        try {
          const { data: fulfilledRow, error: fulfilledRowError } =
            await supabase
              .from('domains')
              .select('id, merchant_id, status')
              .eq('domain', repairedDomain)
              .maybeSingle();

          if (
            !fulfilledRowError &&
            fulfilledRow &&
            fulfilledRow.merchant_id === transaction.merchant_id &&
            fulfilledRow.status !== 'active'
          ) {
            // A prior attempt left a non-active row (e.g. the fulfillment
            // catch persists a pending fallback row): activate it — the
            // registrar order already exists.
            const activateExpiresAt = new Date(
              typeof metadata.purchased_at === 'string'
                ? metadata.purchased_at
                : new Date().toISOString()
            );
            activateExpiresAt.setFullYear(
              activateExpiresAt.getFullYear() + (Number(metadata.years) || 1)
            );
            // Promote to primary if the merchant has no active primary yet —
            // an inactive fallback row was inserted is_primary=false, but once
            // active it may be the merchant's first domain.
            const { data: activatePrimary, error: activatePrimaryError } =
              await supabase
                .from('domains')
                .select('id')
                .eq('merchant_id', transaction.merchant_id)
                .in('domain_type', ['custom', 'purchased'])
                .eq('status', 'active')
                .eq('is_primary', true)
                .limit(1)
                .maybeSingle();
            const { error: activateError } = await supabase
              .from('domains')
              .update({
                status: 'active',
                ssl_status: 'active',
                verified_at: new Date().toISOString(),
                expires_at: activateExpiresAt.toISOString(),
                auto_renew: true,
                is_primary: !activatePrimaryError && !activatePrimary,
                go54_order_id:
                  typeof metadata.domain_registrar_order_id === 'string'
                    ? metadata.domain_registrar_order_id
                    : null,
              })
              .eq('id', fulfilledRow.id);

            if (activateError) {
              logger.error({
                message: 'Failed to activate repaired domains row',
                error: activateError,
                domain: repairedDomain,
                reference,
              });
              return NextResponse.json(
                { error: 'Domain repair failed — will retry' },
                { status: 503 }
              );
            }
            logger.info({
              message:
                'Activated non-active domains row for fulfilled purchase',
              domain: repairedDomain,
              reference,
            });
            revalidateMerchantFeed(transaction.merchant_id);
            after(() => triggerDomainEdgeConfigSync());
          } else if (!fulfilledRowError && !fulfilledRow) {
            const repairYears = Number(metadata.years) || 1;
            const registeredAtIso =
              typeof metadata.purchased_at === 'string'
                ? metadata.purchased_at
                : new Date().toISOString();
            const repairExpiresAt = new Date(registeredAtIso);
            repairExpiresAt.setFullYear(
              repairExpiresAt.getFullYear() + repairYears
            );
            const repairTld =
              typeof metadata.tld === 'string' && metadata.tld.startsWith('.')
                ? metadata.tld
                : `.${repairedDomain.split('.').slice(-1)[0]}`;
            const repairAmount = Number(transaction.amount) || 0;

            // Preserve primary promotion, mirroring the normal insert path:
            // a merchant's first custom/purchased domain becomes primary.
            const { data: repairExistingPrimary, error: repairPrimaryError } =
              await supabase
                .from('domains')
                .select('id')
                .eq('merchant_id', transaction.merchant_id)
                .in('domain_type', ['custom', 'purchased'])
                .eq('status', 'active')
                .eq('is_primary', true)
                .limit(1)
                .maybeSingle();

            const { error: repairError } = await supabase
              .from('domains')
              .insert({
                merchant_id: transaction.merchant_id,
                domain: repairedDomain,
                tld: repairTld,
                domain_type: 'purchased',
                status: 'active',
                is_primary: !repairPrimaryError && !repairExistingPrimary,
                verified_at: new Date().toISOString(),
                ssl_status: 'active',
                go54_order_id:
                  typeof metadata.domain_registrar_order_id === 'string'
                    ? metadata.domain_registrar_order_id
                    : null,
                purchase_price: repairAmount,
                renewal_price: repairAmount,
                registered_at: registeredAtIso,
                expires_at: repairExpiresAt.toISOString(),
                auto_renew: true,
                nameservers: ['ns1.whogohost.com', 'ns2.whogohost.com'],
              });

            if (repairError) {
              logger.error({
                message: 'Failed to repair missing domains row',
                error: repairError,
                domain: repairedDomain,
                reference,
              });
              // Fail the delivery so the gateway redelivers: a transient
              // DB error recovers on the retry instead of leaving the
              // registered domain invisible behind a 200.
              return NextResponse.json(
                { error: 'Domain repair failed — will retry' },
                { status: 503 }
              );
            }
            logger.info({
              message: 'Repaired missing domains row for fulfilled purchase',
              domain: repairedDomain,
              reference,
            });
            revalidateMerchantFeed(transaction.merchant_id);
            after(() => triggerDomainEdgeConfigSync());
          } else if (fulfilledRowError) {
            logger.error({
              message: 'Failed checking domains row for fulfilled purchase',
              error: fulfilledRowError,
              domain: repairedDomain,
              reference,
            });
            return NextResponse.json(
              { error: 'Domain repair check failed — will retry' },
              { status: 503 }
            );
          } else if (
            fulfilledRow &&
            fulfilledRow.merchant_id !== transaction.merchant_id
          ) {
            // The domain is registered to a DIFFERENT merchant than the one
            // this fulfilled transaction belongs to — a conflict a retry
            // cannot resolve. Escalate loudly; do not retry.
            logger.error({
              message:
                'CRITICAL: fulfilled domain registered to a different merchant — manual reconciliation required',
              reference,
              transactionId: transaction.id,
              domain: repairedDomain,
              transactionMerchantId: transaction.merchant_id,
              existingRowMerchantId: fulfilledRow.merchant_id,
            });
          }
        } catch (repairError) {
          logger.error({
            message: 'Domains-row repair threw unexpectedly',
            error: repairError,
            domain: repairedDomain,
            reference,
          });
          return NextResponse.json(
            { error: 'Domain repair failed — will retry' },
            { status: 503 }
          );
        }
        return null;
      }

      logger.info({
        message: 'Processing domain purchase fulfillment',
        reference,
        domain: metadata.domain,
      });

      let claimToken: string | null = null;
      let registrarAttemptStamped = false;
      try {
        // 1. Fetch Merchant Details for Registration
        const { data: merchantData } = await supabase
          .from('merchants')
          .select(
            'business_name, email, address, city, state, phone, users:user_id(first_name, last_name)'
          )
          .eq('id', transaction.merchant_id)
          .single();

        if (!merchantData) {
          logger.error({
            message: 'Merchant not found for domain registration',
            merchantId: transaction.merchant_id,
          });
        } else {
          const merchantUser = Array.isArray(merchantData.users)
            ? merchantData.users[0]
            : merchantData.users;

          // 2. Prepare Contact Info (Fallbacks used for missing fields to ensure registration works)
          // Import dynamically or ensure imported at top - adding simple object here
          const contactName =
            merchantUser?.first_name ||
            merchantData.business_name ||
            'Baci User';
          const contactLastName = merchantUser?.last_name || 'Merchant';

          const contactInfo = {
            firstname: contactName,
            lastname: contactLastName,
            fullname: `${contactName} ${contactLastName}`,
            companyname: merchantData.business_name,
            email: merchantData.email,
            address1: merchantData.address || '123 Baci Street', // Required field
            city: merchantData.city || 'Lagos',
            state: merchantData.state || 'Lagos',
            country: 'NG',
            zipcode: '100001',
            phonenumber: merchantData.phone || '+2348000000000',
          };

          const normalizedDomain = metadata.domain.toLowerCase();
          const purchaseYears = Number(metadata.years) || 1;
          const tld =
            typeof metadata.tld === 'string' && metadata.tld.startsWith('.')
              ? metadata.tld
              : (() => {
                  const multipartTlds = [
                    '.com.ng',
                    '.org.ng',
                    '.net.ng',
                    '.edu.ng',
                    '.name.ng',
                  ];
                  const matchedMultipartTld = multipartTlds.find((candidate) =>
                    normalizedDomain.endsWith(candidate)
                  );

                  if (matchedMultipartTld) {
                    return `.${normalizedDomain.split('.').slice(-2).join('.')}`;
                  }

                  return `.${normalizedDomain.split('.').slice(-1)[0]}`;
                })();

          const markTransactionDomainPurchased = async (
            domainId?: string,
            registrarOrderId?: string
          ) => {
            const updatedMetadata: Record<string, unknown> = {
              ...metadata,
              domain_purchased: normalizedDomain,
              purchased_at: new Date().toISOString(),
            };

            if (domainId) {
              updatedMetadata.domain_id = domainId;
            }
            if (registrarOrderId) {
              // Preserved for the domains-row repair path: identifies the
              // registrar order without ever re-contacting the registrar.
              updatedMetadata.domain_registrar_order_id = registrarOrderId;
            }

            const { error: transactionMetadataError } = await supabase
              .from('transactions')
              .update({ metadata: updatedMetadata })
              .eq('id', transaction.id);

            if (transactionMetadataError) {
              logger.error({
                message: 'Failed to mark transaction as domain_purchased',
                error: transactionMetadataError,
                transactionId: transaction.id,
                domain: normalizedDomain,
              });
              return false;
            }
            return true;
          };

          // 3. Atomically claim fulfillment for this transaction. The
          // dashboard callback (/api/domains/purchase) can be verifying the
          // same completed payment concurrently — only the claim winner may
          // call the registrar, or one payment could be registered (and
          // charged at the registrar) twice.
          const claimOutcome = await claimDomainFulfillment(supabase, {
            transactionId: transaction.id,
            metadata,
            claimant: 'webhook',
          });

          if (claimOutcome.status === 'error') {
            // The claim WRITE failed — fulfillment state is unknown and this
            // paid purchase would otherwise be silently dropped. Fail the
            // webhook delivery so the gateway retries it.
            logger.error({
              message:
                'Domain fulfillment claim write failed — failing webhook for retry',
              reference,
              domain: normalizedDomain,
            });
            return NextResponse.json(
              { error: 'Domain fulfillment claim failed' },
              { status: 500 }
            );
          }

          if (claimOutcome.status === 'contested') {
            if (
              typeof metadata.fulfillment_registrar_attempted_at === 'string'
            ) {
              logger.error({
                message:
                  'Domain fulfillment claim has an unresolved registrar attempt — failing webhook for manual reconciliation',
                reference,
                domain: normalizedDomain,
                transactionId: transaction.id,
                attemptedAt: metadata.fulfillment_registrar_attempted_at,
              });
              return NextResponse.json(
                {
                  error:
                    'Domain fulfillment requires manual reconciliation before retry',
                },
                { status: 503 }
              );
            }

            // Another path (usually the dashboard callback) holds the claim.
            // Return a retryable failure instead of 200: if that claimant
            // dies or releases after a definitive registrar failure, the
            // gateway's redelivery re-enters fulfillment; once the purchase
            // is fulfilled the retry no-ops and returns success.
            logger.info({
              message:
                'Domain fulfillment claimed by another path — deferring to gateway retry',
              reference,
              domain: normalizedDomain,
            });
            return NextResponse.json(
              { error: 'Domain fulfillment in progress' },
              { status: 503 }
            );
          }

          claimToken = claimOutcome.claimedAt;

          const { data: preExistingDomain, error: preExistingDomainError } =
            await supabase
              .from('domains')
              .select('id, merchant_id, status, domain_type, go54_order_id')
              .eq('domain', normalizedDomain)
              .maybeSingle();

          if (preExistingDomainError) {
            logger.error({
              message:
                'Failed checking existing domain before registrar attempt',
              error: preExistingDomainError,
              domain: normalizedDomain,
              reference,
            });
            await releaseDomainFulfillmentClaim(supabase, {
              transactionId: transaction.id,
              metadata,
              claimant: 'webhook',
              claimedAt: claimOutcome.claimedAt,
            });
            claimToken = null;
            return NextResponse.json(
              { error: 'Domain ownership check failed — will retry' },
              { status: 503 }
            );
          }

          if (preExistingDomain) {
            if (preExistingDomain.merchant_id !== transaction.merchant_id) {
              logger.error({
                message:
                  'Domain already belongs to a different merchant before registrar attempt',
                domain: normalizedDomain,
                reference,
                transactionMerchantId: transaction.merchant_id,
                existingRowMerchantId: preExistingDomain.merchant_id,
              });
              await releaseDomainFulfillmentClaim(supabase, {
                transactionId: transaction.id,
                metadata,
                claimant: 'webhook',
                claimedAt: claimOutcome.claimedAt,
              });
              claimToken = null;
              return null;
            }

            if (!hasDomainRegistrarProof(preExistingDomain)) {
              logger.warn({
                message:
                  'Existing domain row lacks registrar proof before registrar attempt — continuing to registrar',
                domain: normalizedDomain,
                reference,
                existingStatus: preExistingDomain.status,
                existingDomainType: preExistingDomain.domain_type,
              });
            } else if (preExistingDomain.status !== 'active') {
              const activateExpiresAt = new Date();
              activateExpiresAt.setFullYear(
                activateExpiresAt.getFullYear() + purchaseYears
              );
              const { data: activatePrimary, error: activatePrimaryError } =
                await supabase
                  .from('domains')
                  .select('id')
                  .eq('merchant_id', transaction.merchant_id)
                  .in('domain_type', ['custom', 'purchased'])
                  .eq('status', 'active')
                  .eq('is_primary', true)
                  .limit(1)
                  .maybeSingle();
              const domainPurchaseAmount = Number(transaction.amount) || 0;
              const { error: activateError } = await supabase
                .from('domains')
                .update({
                  status: 'active',
                  ssl_status: 'active',
                  verified_at: new Date().toISOString(),
                  expires_at: activateExpiresAt.toISOString(),
                  auto_renew: true,
                  is_primary: !activatePrimaryError && !activatePrimary,
                  purchase_price: domainPurchaseAmount,
                  renewal_price: domainPurchaseAmount,
                  nameservers: ['ns1.whogohost.com', 'ns2.whogohost.com'],
                })
                .eq('id', preExistingDomain.id);

              if (activateError) {
                logger.error({
                  message:
                    'Failed activating existing domain row before registrar attempt',
                  error: activateError,
                  domain: normalizedDomain,
                  reference,
                });
                await releaseDomainFulfillmentClaim(supabase, {
                  transactionId: transaction.id,
                  metadata,
                  claimant: 'webhook',
                  claimedAt: claimOutcome.claimedAt,
                });
                claimToken = null;
                return NextResponse.json(
                  { error: 'Domain repair failed — will retry' },
                  { status: 503 }
                );
              }

              const marked = await markTransactionDomainPurchased(
                preExistingDomain.id
              );
              if (!marked) {
                await releaseDomainFulfillmentClaim(supabase, {
                  transactionId: transaction.id,
                  metadata,
                  claimant: 'webhook',
                  claimedAt: claimOutcome.claimedAt,
                });
                claimToken = null;
                return NextResponse.json(
                  { error: 'Domain purchase marker failed — will retry' },
                  { status: 503 }
                );
              }

              logger.info({
                message:
                  'Existing domain row with registrar proof found before registrar attempt; marked transaction fulfilled without re-ordering',
                domain: normalizedDomain,
                reference,
              });
              revalidateMerchantFeed(transaction.merchant_id);
              after(() => triggerDomainEdgeConfigSync());
              return null;
            } else {
              const marked = await markTransactionDomainPurchased(
                preExistingDomain.id
              );
              if (!marked) {
                await releaseDomainFulfillmentClaim(supabase, {
                  transactionId: transaction.id,
                  metadata,
                  claimant: 'webhook',
                  claimedAt: claimOutcome.claimedAt,
                });
                claimToken = null;
                return NextResponse.json(
                  { error: 'Domain purchase marker failed — will retry' },
                  { status: 503 }
                );
              }

              logger.info({
                message:
                  'Existing active purchased domain row found before registrar attempt; marked transaction fulfilled without re-ordering',
                domain: normalizedDomain,
                reference,
              });
              revalidateMerchantFeed(transaction.merchant_id);
              after(() => triggerDomainEdgeConfigSync());
              return null;
            }
          }

          // Preflight registrar credentials BEFORE stamping the attempt: a
          // missing-config failure happens before any registrar request, so
          // releasing is definitively safe (unlike a mid-request failure).
          if (!isGo54Configured()) {
            logger.error({
              message:
                'Domain registrar credentials not configured — cannot fulfill',
              reference,
              domain: normalizedDomain,
            });
            await releaseDomainFulfillmentClaim(supabase, {
              transactionId: transaction.id,
              metadata,
              claimant: 'webhook',
              claimedAt: claimOutcome.claimedAt,
            });
            claimToken = null;
            return NextResponse.json(
              { error: 'Domain registrar not configured' },
              { status: 500 }
            );
          }

          // Stamp the registrar attempt BEFORE contacting the registrar: a
          // crash mid-call must leave a claim that can never be taken over
          // (unknown outcome — manual reconciliation, never a double order).
          const attemptStamped = await markRegistrarAttempted(supabase, {
            transactionId: transaction.id,
            metadata,
            claimant: 'webhook',
            claimedAt: claimOutcome.claimedAt,
          });
          if (!attemptStamped) {
            // Registrar NOT contacted — releasing is safe; let the gateway
            // retry the delivery.
            await releaseDomainFulfillmentClaim(supabase, {
              transactionId: transaction.id,
              metadata,
              claimant: 'webhook',
              claimedAt: claimOutcome.claimedAt,
            });
            claimToken = null;
            return NextResponse.json(
              { error: 'Domain fulfillment could not be started' },
              { status: 500 }
            );
          }
          registrarAttemptStamped = true;

          {
            // 4. Register Domain via Go54
            const registration = await registerDomain({
              domain: normalizedDomain,
              regperiod: purchaseYears,
              contacts: {
                registrant: contactInfo,
                admin: contactInfo,
                tech: contactInfo,
                billing: contactInfo,
              },
            });

            if (registration.success) {
              logger.info({
                message: 'Domain registered successfully',
                domain: metadata.domain,
              });

              // Mark the purchase fulfilled IMMEDIATELY: the registrar order
              // exists now, so even if the domains-row write below fails, no
              // later caller (stale-claim takeover included) may re-register
              // and double-charge. This stamp is also what lets the repair
              // path recognize the registered domain — retry once and
              // escalate loudly if it cannot be written (the attempt marker
              // still prevents duplicate registrar orders).
              const purchasedMarked =
                (await markTransactionDomainPurchased(
                  undefined,
                  registration.orderId
                )) ||
                (await markTransactionDomainPurchased(
                  undefined,
                  registration.orderId
                ));
              if (!purchasedMarked) {
                logger.error({
                  message:
                    'CRITICAL: fulfilled marker write failed after registrar success — manual reconciliation required',
                  reference,
                  transactionId: transaction.id,
                  domain: normalizedDomain,
                  registrarOrderId: registration.orderId,
                });
              }

              // 4. Persist to domains table (used by proxy + storefront resolution)
              const expiresAt = new Date();
              expiresAt.setFullYear(expiresAt.getFullYear() + purchaseYears);
              const nowIso = new Date().toISOString();

              const { data: existingDomain, error: existingDomainError } =
                await supabase
                  .from('domains')
                  .select('id, merchant_id')
                  .eq('domain', normalizedDomain)
                  .maybeSingle();
              const domainPurchaseAmount = Number(transaction.amount) || 0;

              if (existingDomainError) {
                logger.error({
                  message: 'Failed checking existing domain record',
                  error: existingDomainError,
                });
                return NextResponse.json(
                  { error: 'Domain persistence check failed — will retry' },
                  { status: 503 }
                );
              } else if (existingDomain) {
                if (existingDomain.merchant_id !== transaction.merchant_id) {
                  logger.error({
                    message:
                      'Domain already belongs to a different merchant, skipping update',
                    domain: normalizedDomain,
                  });
                } else {
                  const { error: updateDomainError } = await supabase
                    .from('domains')
                    .update({
                      status: 'active',
                      ssl_status: 'active',
                      verified_at: nowIso,
                      expires_at: expiresAt.toISOString(),
                      auto_renew: true,
                      go54_order_id: registration.orderId || null,
                      purchase_price: domainPurchaseAmount,
                      renewal_price: domainPurchaseAmount,
                      nameservers: ['ns1.whogohost.com', 'ns2.whogohost.com'],
                    })
                    .eq('id', existingDomain.id);

                  if (updateDomainError) {
                    logger.error({
                      message: 'Failed to update existing domain record',
                      error: updateDomainError,
                      domain: normalizedDomain,
                    });
                    // The purchase is marked fulfilled; fail the delivery so
                    // the gateway retry lands in the repair path and
                    // activates the row instead of hiding it behind a 200.
                    return NextResponse.json(
                      { error: 'Domain persistence failed — will retry' },
                      { status: 503 }
                    );
                  }
                  await markTransactionDomainPurchased(
                    existingDomain.id,
                    registration.orderId
                  );
                  revalidateMerchantFeed(transaction.merchant_id);
                  after(() => triggerDomainEdgeConfigSync());
                }
              } else {
                const {
                  data: existingPrimaryDomain,
                  error: primaryDomainError,
                } = await supabase
                  .from('domains')
                  .select('id')
                  .eq('merchant_id', transaction.merchant_id)
                  .in('domain_type', ['custom', 'purchased'])
                  .eq('status', 'active')
                  .eq('is_primary', true)
                  .limit(1)
                  .maybeSingle();

                if (primaryDomainError) {
                  logger.error({
                    message: 'Failed checking existing primary domain',
                    error: primaryDomainError,
                  });
                }

                const shouldSetPrimary =
                  !primaryDomainError && !existingPrimaryDomain;

                const { data: insertedDomain, error: domainDbError } =
                  await supabase
                    .from('domains')
                    .insert({
                      merchant_id: transaction.merchant_id,
                      domain: normalizedDomain,
                      tld,
                      domain_type: 'purchased',
                      status: 'active',
                      is_primary: shouldSetPrimary,
                      verified_at: nowIso,
                      ssl_status: 'active',
                      go54_order_id: registration.orderId || null,
                      purchase_price: domainPurchaseAmount,
                      renewal_price: domainPurchaseAmount,
                      registered_at: nowIso,
                      expires_at: expiresAt.toISOString(),
                      auto_renew: true,
                      nameservers: ['ns1.whogohost.com', 'ns2.whogohost.com'],
                    })
                    .select('id')
                    .single();

                if (domainDbError) {
                  logger.error({
                    message: 'Failed to save domain record',
                    error: domainDbError,
                    domain: normalizedDomain,
                  });
                  // The purchase is marked fulfilled; fail the delivery so
                  // the gateway retry lands in the repair path and recreates
                  // the row instead of hiding it behind a 200.
                  return NextResponse.json(
                    { error: 'Domain persistence failed — will retry' },
                    { status: 503 }
                  );
                }
                await markTransactionDomainPurchased(
                  insertedDomain?.id,
                  registration.orderId
                );
                revalidateMerchantFeed(transaction.merchant_id);
                after(() => triggerDomainEdgeConfigSync());
              }
            } else {
              logger.error({
                message: 'Domain registration API failed',
                error: registration.error,
                domain: metadata.domain,
              });
              if (!isRetryableDomainRegistrationFailure(registration.error)) {
                const released = await releaseDomainFulfillmentClaim(supabase, {
                  transactionId: transaction.id,
                  metadata,
                  claimant: 'webhook',
                  claimedAt: claimOutcome.claimedAt,
                });
                if (!released) {
                  logger.error({
                    message:
                      'Terminal registrar failure could not release domain fulfillment claim',
                    error: registration.error,
                    domain: metadata.domain,
                    reference,
                    transactionId: transaction.id,
                  });
                  return NextResponse.json(
                    { error: 'Domain terminal failure release failed' },
                    { status: 503 }
                  );
                }

                logger.error({
                  message:
                    'Domain registration failed terminally — accepting webhook for manual review',
                  error: registration.error,
                  domain: metadata.domain,
                  reference,
                  transactionId: transaction.id,
                });
                return null;
              }

              // Payment succeeded but registration failed: release the claim
              // so the dashboard callback (or a later retry) can fulfill.
              const released = await releaseDomainFulfillmentClaim(supabase, {
                transactionId: transaction.id,
                metadata,
                claimant: 'webhook',
                claimedAt: claimOutcome.claimedAt,
              });
              if (!released) {
                // The attempt marker still blocks every automatic retry — a
                // silently failed release strands this paid purchase.
                logger.error({
                  message:
                    'Domain fulfillment claim release failed after registrar failure — claim retained, manual reconciliation required',
                  reference,
                  transactionId: transaction.id,
                  domain: normalizedDomain,
                });
              }
              // Fail the delivery so the gateway redelivers: a transient
              // registrar outage recovers automatically on retry (the release
              // above made the row claimable again) instead of depending on
              // the user manually retrying the dashboard callback.
              return NextResponse.json(
                { error: 'Domain registration failed — will retry' },
                { status: 503 }
              );
            }
          }
        }
      } catch (err) {
        const fallbackDomain =
          typeof metadata.domain === 'string'
            ? metadata.domain.toLowerCase()
            : null;

        logger.error({
          message: 'Domain fulfillment failed',
          reference,
          transactionId: transaction.id,
          merchantId: transaction.merchant_id,
          domain: fallbackDomain,
          error: err,
        });

        if (claimToken && !registrarAttemptStamped) {
          const released = await releaseDomainFulfillmentClaim(supabase, {
            transactionId: transaction.id,
            metadata,
            claimant: 'webhook',
            claimedAt: claimToken,
          });
          if (!released) {
            logger.error({
              message:
                'Domain fulfillment claim release failed before registrar attempt — retry will wait for stale-claim takeover',
              reference,
              transactionId: transaction.id,
              domain: fallbackDomain,
            });
          }
          return NextResponse.json(
            { error: 'Domain fulfillment failed before registrar attempt' },
            { status: 500 }
          );
        }

        if (
          claimToken &&
          registrarAttemptStamped &&
          isTerminalDomainRegistrationFailure(err)
        ) {
          const released = await releaseDomainFulfillmentClaim(supabase, {
            transactionId: transaction.id,
            metadata,
            claimant: 'webhook',
            claimedAt: claimToken,
          });
          if (!released) {
            logger.error({
              message:
                'Terminal thrown registrar failure could not release domain fulfillment claim',
              reference,
              transactionId: transaction.id,
              domain: fallbackDomain,
              error: err,
            });
            return NextResponse.json(
              { error: 'Domain terminal failure release failed' },
              { status: 503 }
            );
          }

          logger.error({
            message:
              'Domain registration threw terminally — accepting webhook for manual review',
            reference,
            transactionId: transaction.id,
            domain: fallbackDomain,
            error: err,
          });
          return null;
        }

        if (claimToken) {
          // Fulfillment died AFTER the registrar attempt was stamped — the
          // registrar outcome is unknown, so the claim is deliberately NOT
          // released: an automatic retry could double-order the domain.
          // Reconcile manually from this log.
          logger.error({
            message:
              'Domain fulfillment ambiguous — claim retained, manual reconciliation required',
            reference,
            transactionId: transaction.id,
            domain: fallbackDomain,
          });
        }

        if (fallbackDomain) {
          const fallbackTld = fallbackDomain.endsWith('.com.ng')
            ? '.com.ng'
            : fallbackDomain.endsWith('.org.ng')
              ? '.org.ng'
              : fallbackDomain.endsWith('.net.ng')
                ? '.net.ng'
                : fallbackDomain.endsWith('.edu.ng')
                  ? '.edu.ng'
                  : fallbackDomain.endsWith('.name.ng')
                    ? '.name.ng'
                    : `.${fallbackDomain.split('.').slice(-1)[0]}`;
          const nowIso = new Date().toISOString();

          try {
            const { data: existingDomain, error: existingDomainError } =
              await supabase
                .from('domains')
                .select('id, merchant_id')
                .eq('domain', fallbackDomain)
                .maybeSingle();

            if (existingDomainError) {
              logger.error({
                message: 'Failed checking fallback domain persistence state',
                domain: fallbackDomain,
                merchantId: transaction.merchant_id,
                reference,
                error: existingDomainError,
              });
            } else if (!existingDomain) {
              const domainPurchaseAmount = Number(transaction.amount) || 0;
              const verificationTokenExpiresAt = new Date(
                Date.now() + 24 * 60 * 60 * 1000
              ).toISOString();
              const { error: fallbackInsertError } = await supabase
                .from('domains')
                .insert({
                  merchant_id: transaction.merchant_id,
                  domain: fallbackDomain,
                  tld: fallbackTld,
                  domain_type: 'purchased',
                  status: 'pending',
                  is_primary: false,
                  ssl_status: 'pending',
                  verification_token: randomUUID(),
                  verification_token_expires_at: verificationTokenExpiresAt,
                  purchase_price: domainPurchaseAmount,
                  renewal_price: domainPurchaseAmount,
                  registered_at: nowIso,
                  auto_renew: true,
                  nameservers: ['ns1.whogohost.com', 'ns2.whogohost.com'],
                });

              if (fallbackInsertError) {
                logger.error({
                  message:
                    'Failed to persist fallback pending domain record after fulfillment error',
                  domain: fallbackDomain,
                  merchantId: transaction.merchant_id,
                  reference,
                  error: fallbackInsertError,
                });
              }
            }
          } catch (fallbackPersistError) {
            logger.error({
              message: 'Fallback domain persistence threw unexpectedly',
              domain: fallbackDomain,
              merchantId: transaction.merchant_id,
              reference,
              error: fallbackPersistError,
            });
          }
        }
      }

      return null;
    }

    const domainFulfillmentResponse = await fulfillDomainPurchase();
    if (domainFulfillmentResponse) {
      return domainFulfillmentResponse;
    }

    // Update order status if order_id exists
    if (transaction.order_id) {
      const finalizeOutcome = await finalizeOrderGatewayPayment({
        actor: `webhook:${reference}`,
        gateway,
        gatewayResponse,
        orderId: transaction.order_id,
        reference,
        scheduleAfter: (task) => after(task),
        supabase,
        transaction: {
          amount: transaction.amount,
          gateway_reference: transaction.gateway_reference ?? null,
          id: transaction.id,
          merchant_id: transaction.merchant_id,
          order_id: transaction.order_id,
          platform_fee: transaction.platform_fee,
        },
        wonTransactionFlip: true,
      });

      if (finalizeOutcome.kind === 'completion_failed') {
        if (isMerchantInvoicePartialBalanceReview(finalizeOutcome.error)) {
          return NextResponse.json(
            {
              code: 'MERCHANT_INVOICE_PARTIAL_BALANCE_CHANGED',
              error: 'Payment requires reconciliation review',
            },
            { status: 409 }
          );
        }
        logger.error({
          message: 'Failed to update order',
          orderId: transaction.order_id,
          error: finalizeOutcome.error,
        });
        // Review feedback (#1563 thread #1): merchant credit must not depend
        // on the order flip. Record settlement now (idempotent upsert on the
        // A0 partial unique index), then fail the webhook so the gateway
        // redelivers — the redelivery path re-reads the order and heals the
        // flip, unlike the historical swallow-to-200 behavior that wedged
        // ORD-260711-00NT-5.
        try {
          const fallbackSettlement = await recordOrderUpdateFailureSettlement({
            gateway,
            gatewayReference: transaction.gateway_reference,
            gatewayResponse,
            grossAmount: Number(transaction.amount) || 0,
            merchantId: transaction.merchant_id,
            orderId: transaction.order_id,
            platformFee: transaction.platform_fee,
            reference,
            supabase,
          });
          if (fallbackSettlement.kind === 'economics_load_failed') {
            logger.error({
              message:
                'Failed to load order economics for completion-failure settlement fallback',
              error: fallbackSettlement.error,
              orderId: transaction.order_id,
              reference,
            });
            return NextResponse.json(
              {
                code: 'ORDER_PAYMENT_COMPLETION_FAILED',
                error: 'Order payment completion failed',
              },
              { status: 500 }
            );
          }
          if (fallbackSettlement.kind === 'settlement_failed') {
            logger.warn({
              message:
                'record_merchant_settlement errored on order-update-fail fallback path',
              error: fallbackSettlement.error,
              orderId: transaction.order_id,
              reference,
            });
          }
        } catch (fallbackSettlementThrew) {
          logger.warn({
            message:
              'record_merchant_settlement threw on order-update-fail fallback path',
            error: fallbackSettlementThrew,
            orderId: transaction.order_id,
            reference,
          });
        }
        return NextResponse.json(
          {
            code: 'ORDER_PAYMENT_COMPLETION_FAILED',
            error: 'Order payment completion failed',
          },
          { status: 500 }
        );
      }

      if (finalizeOutcome.kind === 'review_failed') {
        // Captured money that must not reopen the order, with no ops trail:
        // fail closed so the gateway redelivers and the review is retried.
        logger.error({
          message: 'Failed to file the reconciliation review for a payment',
          orderId: transaction.order_id,
          reference,
        });
        return NextResponse.json(
          { error: 'Payment reconciliation review unavailable' },
          { status: 500 }
        );
      }

      if (finalizeOutcome.kind === 'order_fetch_failed') {
        logger.error({
          message: 'Paid order fetch failed after atomic completion',
          orderId: transaction.order_id,
          error: finalizeOutcome.error,
        });
        return NextResponse.json(
          { code: 'PAID_ORDER_FETCH_FAILED', error: 'Paid order fetch failed' },
          { status: 500 }
        );
      }

      if (finalizeOutcome.kind === 'inventory_failed') {
        return NextResponse.json(finalizeOutcome.payload, {
          status: finalizeOutcome.status,
        });
      }

      if (finalizeOutcome.kind === 'inventory_cleanup_failed') {
        return NextResponse.json(
          {
            code: 'INVENTORY_CONFIRMATION_CLEANUP_FAILED',
            error: 'Inventory confirmation cleanup failed',
          },
          { status: 500 }
        );
      }

      if (finalizeOutcome.kind === 'completed') {
        logger.info({
          message: 'Order updated successfully',
          orderId: transaction.order_id,
        });
      }
      // 'order_cancelled' and 'order_skipped' fall through to the gateway
      // ack: the finalizer filed a reconciliation_review row for both, and
      // the gateway must not retry a payment we have fully recorded.
    }

    // Domain purchases must NOT record a merchant settlement: the merchant is
    // BUYING a service from Baci, not receiving a customer payment.
    // record_merchant_settlement credits the merchant wallet with
    // gross - gateway_fee - platform_fee, and this transaction's platform_fee
    // is only the markup — so settling here would refund the merchant roughly
    // the registrar cost of the domain they just bought. Baci's revenue for
    // these purchases is tracked on the transaction row itself
    // (amount/platform_fee + metadata cost_price/sell_price).
    const isDomainPurchase =
      (transaction.metadata as Record<string, unknown>)?.transaction_type ===
      'domain_purchase';
    if (isDomainPurchase) {
      logger.info({
        message: 'Domain purchase completed (no merchant settlement recorded)',
        reference,
        gateway,
        amount: Number(transaction.amount) || 0,
      });
    }

    if (gateway === 'paystack') {
      const reconciliationFailure = await reconcileAgenticPaystackDvaSession({
        metadata,
        reference,
        supabase,
        transaction: {
          merchant_id: transaction.merchant_id,
          order_id: transaction.order_id,
        },
      });
      if (reconciliationFailure) {
        return reconciliationFailure;
      }
    }

    logger.info({
      message: 'Payment processed successfully',
      reference,
      transactionId: transaction.id,
    });

    return NextResponse.json({
      success: true,
      message: 'Payment processed successfully',
    });
  } catch (error) {
    logger.error({
      message: 'Payment webhook error',
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
    });
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to manually verify a payment
 *
 * Security: Requires authentication to prevent:
 * - Information disclosure (probing for valid payment references)
 * - Gateway rate limit abuse
 * - Payment reference enumeration attacks
 *
 * Only authenticated merchants can verify their own transactions.
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Require authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const reference = searchParams.get('reference');

    // Validate gateway parameter against allowed values
    const gatewayParam = searchParams.get('gateway');
    const gateway: PaymentGateway =
      gatewayParam === 'korapay' ? 'korapay' : 'paystack';

    // Validate reference with same Zod schema used in POST handler
    const referenceResult = referenceSchema.safeParse(reference);
    if (!referenceResult.success) {
      return NextResponse.json({ error: 'Invalid reference' }, { status: 400 });
    }
    const safeReference = referenceResult.data;

    // SECURITY: Get merchant first to establish authorization context
    const { data: merchant } = await supabase
      .from('merchants')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!merchant) {
      return NextResponse.json(
        { error: 'Merchant account not found' },
        { status: 403 }
      );
    }

    // SECURITY: Query transaction with BOTH reference AND merchant_id
    // This prevents IDOR attacks - user can only access their own transactions
    const { data: transaction } = await supabase
      .from('transactions')
      .select('id, merchant_id')
      .eq('gateway_reference', safeReference)
      .eq('merchant_id', merchant.id) // Authorization enforced in query
      .single();

    if (!transaction) {
      // Could be either not found OR not owned by this merchant - don't reveal which
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }

    // Transaction verified to belong to authenticated merchant
    const paymentData =
      gateway === 'paystack'
        ? await verifyPaystackPayment(safeReference)
        : await verifyKorapayPayment(safeReference);

    return NextResponse.json({
      success: true,
      gateway,
      payment: paymentData,
    });
  } catch (error) {
    logger.error({
      message: 'Payment verification error',
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
    });
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
