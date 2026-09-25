import { useEffect, useState } from 'react';

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 150_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const CONFIRMED_PAYMENT_STATUSES = new Set(['paid', 'bnpl_approved']);
const CANCELLED_PAYMENT_STATUSES = new Set(['cancelled', 'refunded']);

export type CreditDirectVerificationPhase =
  | 'idle'
  | 'polling'
  | 'confirmed'
  | 'cancelled'
  | 'timeout';

interface UseCreditDirectVerificationOptions {
  active: boolean;
  orderId: string | null;
  merchantSlug: string;
  trackingToken: string | null;
  lookupEmail: string | null;
  pollIntervalMs?: number;
  timeoutMs?: number;
  requestTimeoutMs?: number;
}

interface OrderStatusResponse {
  payment_status?: string | null;
  total?: unknown;
  currency?: unknown;
  inventory_confirmed?: boolean;
}

export interface CreditDirectConfirmedOrder {
  total?: number;
  currency?: string;
}

/**
 * Polls the storefront order endpoint while a Credit Direct checkout attempt
 * is pending confirmation. Credit Direct's SDK offers no redirect URL or
 * status API, so once its hosted popup replaces the launcher page the only
 * way to detect completion is watching the order's payment_status flip to
 * bnpl_approved/paid via the provider webhook. Confirmation additionally
 * requires the server-confirmed inventory proof: the webhook writes
 * approval before inventory confirmation lands (rolling it back on
 * failure), so the approved status alone can precede a rollback.
 */
export function useCreditDirectVerification({
  active,
  orderId,
  merchantSlug,
  trackingToken,
  lookupEmail,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}: UseCreditDirectVerificationOptions) {
  const [phase, setPhase] = useState<CreditDirectVerificationPhase>('idle');
  const [pollEpoch, setPollEpoch] = useState(0);
  // Retains the confirming read's revenue fields so the first conversion
  // capture carries value/currency (a later lookup would be suppressed by
  // the once-guard).
  const [confirmedOrder, setConfirmedOrder] =
    useState<CreditDirectConfirmedOrder | null>(null);

  useEffect(() => {
    if (!active || !orderId) {
      setPhase('idle');
      setConfirmedOrder(null);
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let activeController: AbortController | null = null;
    setPhase('polling');
    setConfirmedOrder(null);

    const query = new URLSearchParams({ merchant_slug: merchantSlug });
    if (trackingToken) query.set('token', trackingToken);
    if (lookupEmail) query.set('email', lookupEmail);
    const orderUrl = `/api/storefront/orders/${orderId}?${query.toString()}`;
    const startedAt = Date.now();

    const checkOnce = async () => {
      // Abort each poll request on its own deadline so a hung fetch on a
      // flaky connection cannot hold the customer past the overall timeout.
      const controller = new AbortController();
      activeController = controller;
      const requestDeadline = setTimeout(
        () => controller.abort(),
        requestTimeoutMs
      );
      try {
        const response = await fetch(orderUrl, {
          signal: controller.signal,
        });
        if (response.ok) {
          const order = (await response.json()) as OrderStatusResponse;
          const paymentStatus = order.payment_status || '';
          if (
            CONFIRMED_PAYMENT_STATUSES.has(paymentStatus) &&
            order.inventory_confirmed === true
          ) {
            if (!disposed) {
              const confirmedTotal = Number(order.total);
              const confirmedCurrency =
                typeof order.currency === 'string' && order.currency.trim()
                  ? order.currency.trim()
                  : undefined;
              setConfirmedOrder({
                ...(Number.isFinite(confirmedTotal)
                  ? { total: confirmedTotal }
                  : {}),
                ...(confirmedCurrency ? { currency: confirmedCurrency } : {}),
              });
              setPhase('confirmed');
            }
            return;
          }
          if (CANCELLED_PAYMENT_STATUSES.has(paymentStatus)) {
            if (!disposed) setPhase('cancelled');
            return;
          }
        }
      } catch {
        // Transient network failure or aborted request — keep polling
        // until the deadline.
      } finally {
        clearTimeout(requestDeadline);
      }

      if (disposed) return;
      if (Date.now() - startedAt >= timeoutMs) {
        setPhase('timeout');
        return;
      }
      timer = setTimeout(() => {
        void checkOnce();
      }, pollIntervalMs);
    };

    void checkOnce();

    return () => {
      disposed = true;
      activeController?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [
    active,
    orderId,
    merchantSlug,
    trackingToken,
    lookupEmail,
    pollIntervalMs,
    timeoutMs,
    requestTimeoutMs,
    pollEpoch,
  ]);

  const restart = () => setPollEpoch((epoch) => epoch + 1);

  return { phase, restart, confirmedOrder };
}
