/**
 * Juicyway Payment Operations
 * Initialize, fetch, verify, and capture payments
 */

import { logger } from '../logger';
import { JUICYWAY_BASE_URL, juicywayRequest } from './client';
import {
  JUICYWAY_CHAIN_SUPPORT,
  type JuicywayApiResponse,
  type JuicywayCryptoChain,
  type JuicywayCryptoPaymentResponse,
  type JuicywayPaymentInitRequest,
  type JuicywayPaymentSession,
  type JuicywayPaymentStatus,
  type JuicywayResult,
  type JuicywayStablecoin,
  PaymentSessionResponseSchema,
} from './types';

// UUID validation regex (reused across functions)
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Initialize a payment session
 * Returns checkout URL for card payments or virtual account for bank transfers
 */
export async function initializePayment(
  data: JuicywayPaymentInitRequest
): Promise<JuicywayPaymentSession> {
  if (data.amount < 100) {
    throw new Error('Amount must be at least 100 (minor units)');
  }
  if (data.reference.length > 50) {
    throw new Error('Reference must be max 50 characters');
  }
  if (data.description.length > 200) {
    throw new Error('Description must be max 200 characters');
  }

  logger.info({
    message: 'Juicyway payment request',
    amount: data.amount,
    currency: data.currency,
    paymentMethod: data.payment_method.type,
    reference: data.reference,
    customerEmail: data.customer.email,
    direction: data.direction,
  });

  const result = await juicywayRequest<JuicywayPaymentSession>(
    '/payment-sessions',
    { method: 'POST', body: JSON.stringify(data) }
  );

  if (!result.success) {
    throw new Error(result.error);
  }

  const rawResult = result.data.data || result.data;

  logger.info({
    message: 'Juicyway raw response structure',
    hasData: !!result.data.data,
    hasLinks: !!(rawResult as { links?: unknown }).links,
    linksContent: (rawResult as { links?: unknown }).links,
    hasCheckoutUrl: !!(rawResult as { checkout_url?: string }).checkout_url,
    hasPayment: !!(rawResult as { payment?: unknown }).payment,
    paymentId: (rawResult as { payment?: { id?: string } }).payment?.id,
    topLevelId: (rawResult as { id?: string }).id,
  });

  const parseResult = PaymentSessionResponseSchema.safeParse(rawResult);
  if (!parseResult.success) {
    logger.warn({
      message: 'Juicyway response validation warning',
      issues: parseResult.error.issues,
    });
  }

  const checkoutUrl =
    (rawResult as JuicywayApiResponse<unknown>).links?.redirect_url ||
    (rawResult as { checkout_url?: string }).checkout_url ||
    (rawResult as { data?: { links?: { redirect_url?: string } } }).data?.links
      ?.redirect_url;

  if (
    !checkoutUrl &&
    (rawResult as { payment_method?: { type?: string } }).payment_method
      ?.type === 'card'
  ) {
    logger.warn({
      message:
        'No checkout URL returned for card payment - may need 3DS redirect',
      paymentId: (rawResult as JuicywayApiResponse<unknown>).payment?.id,
    });
  }

  const session: JuicywayPaymentSession = {
    ...(rawResult as JuicywayPaymentSession),
    checkout_url: checkoutUrl,
    id:
      (rawResult as { id?: string }).id ||
      (rawResult as JuicywayApiResponse<unknown>).payment?.id ||
      '',
  };

  logger.info({
    message: 'Juicyway payment initialized',
    sessionId: session.id,
    hasCheckoutUrl: !!session.checkout_url,
  });

  return session;
}

/**
 * Fetch a payment by ID (with Result type for better error handling)
 */
export async function getPayment(
  paymentId: string
): Promise<JuicywayResult<JuicywayPaymentSession>> {
  if (!UUID_REGEX.test(paymentId)) {
    return {
      success: false,
      error: 'Invalid payment ID format (must be UUID)',
      code: 'VALIDATION_ERROR',
    };
  }

  const result = await juicywayRequest<JuicywayPaymentSession>(
    `/payments/${paymentId}`,
    { method: 'GET' }
  );

  if (!result.success) {
    return result;
  }

  const paymentData = result.data.data || result.data;

  return {
    success: true,
    data: paymentData as unknown as JuicywayPaymentSession,
  };
}

/**
 * Verify a payment status
 */
export async function verifyPayment(paymentId: string): Promise<
  JuicywayResult<{
    success: boolean;
    status: JuicywayPaymentStatus;
    payment: JuicywayPaymentSession;
  }>
> {
  const result = await getPayment(paymentId);

  if (!result.success) {
    return result;
  }

  return {
    success: true,
    data: {
      success: result.data.status === 'succeeded',
      status: result.data.status,
      payment: result.data,
    },
  };
}

/**
 * Fetch a payment session by ID (GET /payment-sessions/{id})
 * Used to poll for crypto address after capture returns 'pending'
 */
export async function getPaymentSession(
  sessionId: string,
  signal?: AbortSignal
): Promise<JuicywayResult<JuicywayCryptoPaymentResponse>> {
  if (!UUID_REGEX.test(sessionId)) {
    return {
      success: false,
      error: 'Invalid session ID format (must be UUID)',
      code: 'VALIDATION_ERROR',
    };
  }

  const result = await juicywayRequest<JuicywayCryptoPaymentResponse>(
    `/payment-sessions/${sessionId}`,
    { method: 'GET', signal }
  );

  if (!result.success) {
    return result;
  }

  const rawResult = result.data.data || result.data;

  return {
    success: true,
    data: rawResult as JuicywayCryptoPaymentResponse,
  };
}

/**
 * Capture a payment session with crypto/stablecoin details
 * This generates a blockchain address for the customer to send funds to
 */
export async function capturePaymentWithCrypto(
  paymentId: string,
  chain: JuicywayCryptoChain,
  currency: JuicywayStablecoin
): Promise<JuicywayResult<JuicywayCryptoPaymentResponse>> {
  if (!UUID_REGEX.test(paymentId)) {
    return {
      success: false,
      error: 'Invalid payment ID format (must be UUID)',
      code: 'VALIDATION_ERROR',
    };
  }

  const supportedChains = JUICYWAY_CHAIN_SUPPORT[currency];
  if (!supportedChains.includes(chain)) {
    return {
      success: false,
      error: `${currency} is not supported on ${chain}. Supported chains: ${supportedChains.join(', ')}`,
      code: 'VALIDATION_ERROR',
    };
  }

  const mode = JUICYWAY_BASE_URL.includes('sandbox') ? 'sandbox' : 'live';

  logger.info({
    message: 'Capturing payment with crypto',
    paymentId,
    chain,
    currency,
    mode,
    baseUrl: JUICYWAY_BASE_URL,
  });

  const result = await juicywayRequest<JuicywayCryptoPaymentResponse>(
    `/payment-sessions/${paymentId}`,
    {
      method: 'POST',
      body: JSON.stringify({
        crypto_address: { chain, currency },
      }),
    }
  );

  if (!result.success) {
    return result;
  }

  const rawResult = result.data.data || result.data;

  logger.info({
    message: 'Crypto capture raw response',
    paymentId,
    mode,
    rawStatus: (rawResult as Record<string, unknown>).status,
    paymentStatus: (rawResult as JuicywayCryptoPaymentResponse).payment?.status,
    address: (rawResult as JuicywayCryptoPaymentResponse).payment
      ?.payment_method?.address,
    chain: (rawResult as JuicywayCryptoPaymentResponse).payment?.payment_method
      ?.chain,
    fullResponse: JSON.stringify(rawResult).substring(0, 500),
  });

  return {
    success: true,
    data: rawResult as JuicywayCryptoPaymentResponse,
  };
}
