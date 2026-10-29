import type { PendingCheckoutOrderSnapshot } from '../pending-checkout-order';
import {
  getCartCookieEpoch,
  isCartCookieEpochCurrent,
} from '@/hooks/cart/cart-cross-tab-lock';
import {
  isCartSessionRetiring,
  runBoundedCartSessionWrite,
} from '@/hooks/cart/cart-session-write-fence';
import {
  ensureCartDeviceRevocationCleared,
  isCartDeviceRevocationPending,
} from '@/hooks/cart/shared-cart-session-revoke-client';
import { getCartSessionGeneration } from '@/hooks/cart/shared-cart-storage';
import { fetchWithCsrf } from '@/lib/api-client';
import { parseRedvaultOrderQuote } from '../parse-redvault-order-quote';
import { persistPendingCheckoutOrder } from '../persist-pending-checkout-order';
import { readRedvaultReviewRecovery } from '../read-redvault-review-recovery';
import {
  clearRedvaultUncertainAttempt,
  readRedvaultUncertainAttempt,
} from '../redvault-uncertain-attempt';
import { reconcileRedvaultUncertainAttempt } from './reconcile-redvault-uncertain-attempt';

type RecoveryResult =
  | { kind: 'none' | 'retired' | 'unavailable' }
  | { kind: 'recovered'; snapshot: PendingCheckoutOrderSnapshot };

/** Replay only the previously approved order request; never initialize payment. */
export async function recoverRedvaultUncertainAttempt({
  merchantId,
  merchantSlug,
  pendingOrder,
  request = fetchWithCsrf,
  signal,
}: {
  merchantId: string;
  merchantSlug?: string;
  pendingOrder: PendingCheckoutOrderSnapshot | null;
  request?: (url: string, init?: RequestInit) => Promise<Response>;
  signal?: AbortSignal;
}): Promise<RecoveryResult> {
  const stored = readRedvaultUncertainAttempt(merchantId);
  if (stored.kind === 'none') return { kind: 'none' };
  if (stored.kind !== 'pending') return { kind: 'unavailable' };
  try {
    return await runBoundedCartSessionWrite<RecoveryResult>(
      merchantSlug,
      { kind: 'unavailable' },
      (requestSignal) =>
        recoverLocked(
          merchantId,
          merchantSlug,
          pendingOrder,
          request,
          requestSignal
        ),
      signal,
      isCartDeviceRevocationPending(merchantSlug)
        ? (requestSignal) =>
            ensureCartDeviceRevocationCleared(merchantSlug, requestSignal)
        : undefined
    );
  } catch {
    return { kind: 'unavailable' };
  }
}

async function recoverLocked(
  merchantId: string,
  merchantSlug: string | undefined,
  pendingOrder: PendingCheckoutOrderSnapshot | null,
  request: (url: string, init?: RequestInit) => Promise<Response>,
  signal: AbortSignal
): Promise<RecoveryResult> {
  const generation = getCartSessionGeneration(merchantSlug);
  const epoch = getCartCookieEpoch(merchantSlug);
  const isCurrent = () =>
    !signal.aborted &&
    !isCartSessionRetiring(merchantSlug) &&
    getCartSessionGeneration(merchantSlug) === generation &&
    isCartCookieEpochCurrent(epoch, merchantSlug);
  const stored = readRedvaultUncertainAttempt(merchantId);
  if (stored.kind === 'none') return { kind: 'none' };
  if (stored.kind !== 'pending' || !isCurrent()) return { kind: 'unavailable' };
  const { attempt } = stored;
  const binding = attempt.parsedOrder.shared_cart;
  if (!binding) return { kind: 'unavailable' };

  if (pendingOrder) {
    const ready = readRedvaultReviewRecovery(pendingOrder, merchantId);
    if (
      !isCurrent() ||
      !ready ||
      ready.ready.cartId !== binding.cart_id ||
      ready.ready.checkoutFingerprint !== attempt.fingerprint
    ) {
      return { kind: 'unavailable' };
    }
    try {
      clearRedvaultUncertainAttempt(merchantId, attempt.idempotencyKey);
    } catch {
      /* retry later */
    }
    return { kind: 'recovered', snapshot: pendingOrder };
  }

  const age = Date.now() - attempt.createdAt;
  if (age < -60_000) return { kind: 'unavailable' };
  let payload: unknown;
  if (age <= 30 * 60_000) {
    try {
      const response = await request('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': attempt.idempotencyKey,
          'X-Checkout-Recovery': '1',
        },
        body: JSON.stringify(attempt.orderRequest),
        signal,
      });
      if (response.status === 200 || response.status === 201)
        payload = await response.json();
    } catch {
      // Reconcile the session before allowing any fresh checkout.
    }
  }
  if (!isCurrent()) return { kind: 'unavailable' };
  if (!payload) {
    const outcome = await reconcileRedvaultUncertainAttempt({
      attempt,
      merchantSlug,
      request,
      signal,
    });
    if (!isCurrent()) return { kind: 'unavailable' };
    if (outcome.kind === 'retired') {
      clearRedvaultUncertainAttempt(merchantId, attempt.idempotencyKey);
      if (readRedvaultUncertainAttempt(merchantId).kind !== 'none')
        return { kind: 'unavailable' };
      return { kind: 'retired' };
    }
    if (outcome.kind !== 'submitted') return { kind: 'unavailable' };
    payload = outcome.payload;
  }
  try {
    if (!isCurrent()) return { kind: 'unavailable' };
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('order' in payload) ||
      !payload.order ||
      typeof payload.order !== 'object'
    )
      return { kind: 'unavailable' };
    const order = payload.order as Record<string, unknown>;
    if (
      typeof order.id !== 'string' ||
      !order.id ||
      typeof order.tracking_token !== 'string' ||
      !order.tracking_token ||
      typeof order.currency !== 'string' ||
      order.currency.trim().toUpperCase() !== 'NGN' ||
      typeof order.total !== 'number' ||
      !Number.isFinite(order.total)
    ) {
      return { kind: 'unavailable' };
    }
    const summary = parseRedvaultOrderQuote(payload);
    const orderNumber =
      typeof order.order_number === 'string' && order.order_number
        ? order.order_number
        : order.id.slice(0, 8).toUpperCase();
    const ready = {
      cartId: binding.cart_id,
      billingAddress: attempt.billingAddress,
      customerEmail: attempt.customer.email,
      customerName: attempt.customer.name,
      customerPhone: attempt.customer.phone,
      currency: 'NGN',
      orderId: order.id,
      checkoutFingerprint: attempt.fingerprint,
      trackingToken: order.tracking_token,
      total: order.total,
      orderNumber,
    };
    const snapshot: PendingCheckoutOrderSnapshot = {
      orderId: order.id,
      orderNumber,
      trackingToken: order.tracking_token,
      merchantId,
      customerEmail: attempt.customer.email,
      customerPhone: attempt.customer.phone,
      checkoutFingerprint: attempt.fingerprint,
      paymentMethod: 'uba_redvault',
      amountDueToGateway: summary.payableKobo / 100,
      createdAt: new Date().toISOString(),
      redvaultReview: {
        ready,
        summary,
        recoveryFence: {
          merchantSlug: merchantSlug ?? null,
          epoch: epoch ?? null,
        },
      },
    };
    if (!isCurrent() || !readRedvaultReviewRecovery(snapshot, merchantId))
      return { kind: 'unavailable' };
    persistPendingCheckoutOrder(snapshot);
    try {
      clearRedvaultUncertainAttempt(merchantId, attempt.idempotencyKey);
    } catch {
      /* retained safely */
    }
    return { kind: 'recovered', snapshot };
  } catch {
    return { kind: 'unavailable' };
  }
}
