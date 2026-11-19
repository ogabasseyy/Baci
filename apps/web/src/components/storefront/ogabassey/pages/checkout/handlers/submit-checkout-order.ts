import type { buildCheckoutOrderRequest } from '../build-checkout-order-request';
import type { RedvaultQuoteSummary } from '../components/redvault/RedvaultPaymentOption';
import type { ResolvePendingCheckoutOrderResult } from '../pending-checkout-order';
import { parseRedvaultOrderQuote } from '../redvault-payment-response';
import type { PaymentMethod } from '../types';

export interface CheckoutPaymentOrder {
  id: string;
  order_number?: string;
  payment_status?: string;
  total?: number;
  tracking_token?: string;
  currency?: string | null;
  payment_method?: string | null;
}

export interface CheckoutWalletRedemption {
  amountUsed: number;
  newBalance: number;
}

export interface CheckoutOrderErrorData {
  code?: unknown;
  details?: unknown;
  error?: unknown;
  rejectedVoucherToken?: unknown;
}

export interface CheckoutOrderResponse {
  order: CheckoutPaymentOrder;
  idempotency?: { replayed?: boolean };
  wallet?: CheckoutWalletRedemption | null;
  amountDueToGateway?: number;
}

export interface SubmitCheckoutOrderOptions {
  resolvedPendingOrder: ResolvePendingCheckoutOrderResult;
  getIdempotencyKey: () => Promise<string>;
  orderRequest: ReturnType<typeof buildCheckoutOrderRequest>;
  paymentMethod: PaymentMethod;
  total: number;
  /** Removes only lines the server rejects as irredeemable. */
  onVoucherRejected: (errorData: CheckoutOrderErrorData) => void;
  /** Clears a persisted snapshot/key that cannot safely be replayed. */
  onPendingOrderInvalidated: () => Promise<void>;
  onShippingRateRejected: () => void;
  getOrderErrorMessage: (errorData: CheckoutOrderErrorData) => string;
  onBeforeBoundRedvaultSend?: (attempt: {
    idempotencyKey: string;
    orderRequest: ReturnType<typeof buildCheckoutOrderRequest>;
  }) => void;
  request?: typeof fetch;
}

export interface SubmittedCheckoutOrder {
  order: CheckoutPaymentOrder;
  freshOrder?: true;
  wallet: CheckoutWalletRedemption | null;
  amountDueToGateway: number;
  redvaultSummary?: RedvaultQuoteSummary;
}

const SHIPPING_RATE_REJECTION_CODES = new Set([
  'SHIPPING_FEE_MISMATCH',
  'SHIPPING_RATE_INVALID',
  'SHIPPING_RATE_ZONE_MISMATCH',
  'SHIPPING_RATE_CONDITION_UNMET',
]);

function getErrorCode(errorData: CheckoutOrderErrorData): string {
  if (
    errorData &&
    typeof errorData === 'object' &&
    typeof (errorData as { code?: unknown }).code === 'string'
  ) {
    return (errorData as { code: string }).code;
  }
  return '';
}

async function readOrderError(
  response: Response
): Promise<CheckoutOrderErrorData> {
  try {
    const data: unknown = await response.json();
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as CheckoutOrderErrorData)
      : {};
  } catch {
    return {};
  }
}

/**
 * Reuses a still-payable checkout row where possible, otherwise creates the
 * order exactly once with the supplied idempotency key. Form/address assembly
 * stays in CheckoutPage; this boundary owns the server order transition.
 */
export async function submitCheckoutOrder({
  getIdempotencyKey,
  orderRequest,
  paymentMethod,
  total,
  onVoucherRejected,
  onPendingOrderInvalidated,
  onShippingRateRejected,
  getOrderErrorMessage,
  onBeforeBoundRedvaultSend,
  request = fetch,
  resolvedPendingOrder,
}: SubmitCheckoutOrderOptions): Promise<SubmittedCheckoutOrder> {
  if (
    resolvedPendingOrder.redvaultUnresolved ||
    resolvedPendingOrder.paidOrder ||
    resolvedPendingOrder.ordinaryPendingOrder ||
    resolvedPendingOrder.redvaultPendingOrder ||
    resolvedPendingOrder.clearStoredOrder
  ) {
    throw new Error('Pending checkout order must be fenced before submission');
  }
  const reusablePendingOrder = resolvedPendingOrder;

  if (reusablePendingOrder.reusableOrder) {
    return {
      order: reusablePendingOrder.reusableOrder.order,
      wallet: null,
      amountDueToGateway: reusablePendingOrder.reusableOrder.amountDueToGateway,
    };
  }

  const idempotencyKey = await getIdempotencyKey();
  const requestOptions: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(orderRequest),
  };
  const canRetryBoundRedvault =
    paymentMethod === 'uba_redvault' &&
    orderRequest.payment_method === 'uba_redvault' &&
    Boolean(orderRequest.shared_cart) &&
    idempotencyKey.trim().length > 0 &&
    !orderRequest.items.some(
      (item) => item.voucher_award_id || item.voucher_token
    );
  if (canRetryBoundRedvault) {
    if (!onBeforeBoundRedvaultSend) {
      throw new Error(
        'UBA checkout recovery is unavailable. Please try again.'
      );
    }
    onBeforeBoundRedvaultSend({ idempotencyKey, orderRequest });
  }
  let response: Response;
  try {
    response = await request('/api/orders', requestOptions);
  } catch (error) {
    // This bound RPC verifies and replays the same draft for the same
    // session and key. Retry only a transport failure, never a payment
    // initialization or a voucher path that drops the idempotency key.
    if (!(error instanceof TypeError) || !canRetryBoundRedvault) throw error;
    response = await request('/api/orders', {
      ...requestOptions,
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'X-Checkout-Recovery': '1',
      },
    });
  }

  if (!response.ok) {
    const errorData = await readOrderError(response);
    const errorCode = getErrorCode(errorData);
    if (
      errorCode === 'CHECKOUT_ORDER_NOT_REUSABLE' ||
      errorCode === 'CHECKOUT_IDEMPOTENCY_CONFLICT'
    ) {
      await onPendingOrderInvalidated();
    }
    onVoucherRejected(errorData);
    console.error('Order creation failed:', {
      status: response.status,
      errorData,
    });
    if (SHIPPING_RATE_REJECTION_CODES.has(errorCode)) {
      onShippingRateRejected();
    }
    throw new Error(getOrderErrorMessage(errorData));
  }

  const result = (await response
    .json()
    .catch(() => null)) as CheckoutOrderResponse | null;
  if (!result?.order?.id) {
    throw new Error('Order creation failed');
  }

  if (paymentMethod === 'uba_redvault') {
    const summary = parseRedvaultOrderQuote(result);
    return {
      order: result.order,
      wallet: result.wallet ?? null,
      amountDueToGateway: summary.payableKobo / 100,
      redvaultSummary: summary,
    };
  }

  return {
    order: result.order,
    wallet: result.wallet ?? null,
    amountDueToGateway: result.amountDueToGateway ?? total,
    ...(response.status === 201 &&
    response.headers.get('x-idempotency-replayed') !== 'true' &&
    result.idempotency?.replayed !== true
      ? { freshOrder: true as const }
      : {}),
  };
}
