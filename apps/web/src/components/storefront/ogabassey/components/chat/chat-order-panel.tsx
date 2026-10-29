'use client';

import { useRef, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import { joinRouteBasePath } from '@/lib/routes';
import {
  storefrontChatAccountSchemas,
  type StorefrontChatOrder,
} from '@/schemas/storefront-chat-account';
import type { useChatAccountScope } from './use-chat-account-scope';

export function ChatOrderPanel({
  merchantSlug,
  basePath,
  scope,
}: {
  merchantSlug: string;
  basePath: string;
  scope: ReturnType<typeof useChatAccountScope>;
}) {
  const [orders, setOrders] = useState<StorefrontChatOrder[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'signin' | 'error'>(
    'idle'
  );
  const [confirming, setConfirming] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [hasMoreOrders, setHasMoreOrders] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);

  const loadOrders = async () => {
    if (pending.current || scope.cancellationBusy) return;
    pending.current = true;
    const token = scope.capture();
    setState('loading');
    setOrders(null);
    setConfirming(null);
    try {
      const response = await fetch(
        `/api/storefront/orders?merchantSlug=${encodeURIComponent(merchantSlug)}`,
        {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: AbortSignal.timeout(15_000),
        }
      );
      if (!scope.isCurrent(token)) return;
      if (response.status === 401) {
        setState('signin');
        return;
      }
      if (!response.ok) throw new Error('Order lookup unavailable');
      const parsed = storefrontChatAccountSchemas.orders.safeParse(
        await response.json()
      );
      if (!scope.isCurrent(token)) return;
      if (!parsed.success) throw new Error('Invalid order response');
      scope.resolveCancellationWarning(parsed.data.orders);
      setOrders(parsed.data.orders.slice(0, 20));
      setHasMoreOrders(parsed.data.orders.length > 20);
      setResults({});
      setState('idle');
    } catch {
      if (scope.isCurrent(token)) setState('error');
    } finally {
      pending.current = false;
    }
  };

  const cancel = async (orderId: string) => {
    if (
      pending.current ||
      confirming !== orderId ||
      !scope.startCancellation(orderId)
    )
      return;
    pending.current = true;
    const token = scope.capture();
    setSubmitting(true);
    let confirmed = false;
    try {
      const response = await fetchWithCsrf(
        `/api/storefront/account/orders/${orderId}/cancel`,
        {
          method: 'POST',
          body: '{}',
          signal: AbortSignal.timeout(15_000),
        }
      );
      if (!scope.isCurrent(token)) return;
      if (response.status === 409) {
        confirmed = true;
        setResults((previous) => ({
          ...previous,
          [orderId]:
            'This order can no longer be cancelled. Refresh your orders to check its status.',
        }));
      } else if (response.ok) {
        const payload = storefrontChatAccountSchemas.cancellation.safeParse(
          await response.json()
        );
        if (!scope.isCurrent(token)) return;
        if (payload.success) {
          confirmed = true;
          setOrders(
            (previous) =>
              previous?.map((order) =>
                order.id === orderId
                  ? { ...order, shipping_status: 'cancelled' }
                  : order
              ) ?? null
          );
        }
        setResults((previous) => ({
          ...previous,
          [orderId]: payload.success
            ? payload.data.cancelled
              ? 'Your order was cancelled.'
              : 'This order was already cancelled.'
            : 'We could not confirm whether your order was cancelled. Check its status before trying again.',
        }));
      } else {
        setResults((previous) => ({
          ...previous,
          [orderId]:
            'We could not confirm whether your order was cancelled. Check its status before trying again.',
        }));
      }
    } catch {
      if (!scope.isCurrent(token)) return;
      setResults((previous) => ({
        ...previous,
        [orderId]:
          'We could not confirm whether your order was cancelled. Check its status before trying again.',
      }));
    } finally {
      pending.current = false;
      scope.finishCancellation(token, confirmed);
      if (scope.isCurrent(token)) {
        setConfirming(null);
        setSubmitting(false);
      }
    }
  };

  return (
    <section
      aria-label="Secure order actions"
      className="mt-3 border-t border-gray-200 pt-3 text-sm"
    >
      <button
        type="button"
        onClick={loadOrders}
        disabled={state === 'loading' || submitting || scope.cancellationBusy}
        className="rounded-lg border px-3 py-2 font-medium"
      >
        {state === 'loading'
          ? 'Loading orders…'
          : orders
            ? 'Refresh orders'
            : 'View my orders'}
      </button>
      {state === 'signin' && (
        <p className="mt-2">
          <a
            href={joinRouteBasePath(basePath, '/account/login')}
            className="underline"
          >
            Sign in
          </a>{' '}
          to view your orders. Guest customers can use their secure tracking
          link or contact support.
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="mt-2">
          We couldn’t load your orders. Please try again.
        </p>
      )}
      {orders?.length === 0 && (
        <p className="mt-2">No orders were found for this account.</p>
      )}
      {orders?.some(
        (order) =>
          order.shipping_status !== 'cancelled' &&
          scope.isCancellationResolved(order.id)
      ) && (
        <p role="status" className="mt-2">
          An order status may have changed. Refresh your orders to check the
          latest status.
        </p>
      )}
      {orders?.map((order) => (
        <div key={order.id} className="mt-3 rounded-lg border p-2">
          <p className="font-semibold">
            Order {order.order_number ?? 'number unavailable'}
          </p>
          <p>Payment: {order.payment_status ?? 'unknown'}</p>
          <p>Delivery: {order.shipping_status ?? 'unknown'}</p>
          <a
            className="underline"
            href={joinRouteBasePath(basePath, `/account/orders/${order.id}`)}
          >
            View order details
          </a>
          {results[order.id] ? (
            <p role="status" className="mt-2">
              {results[order.id]}
            </p>
          ) : confirming === order.id ? (
            <div className="mt-2 space-y-2">
              <p>Cancel this order? This cannot be undone.</p>
              <button
                type="button"
                disabled={submitting}
                onClick={() => cancel(order.id)}
                className="rounded-lg border px-3 py-2 font-medium"
              >
                {submitting ? 'Cancelling…' : 'Confirm cancellation'}
              </button>{' '}
              <button
                type="button"
                disabled={submitting}
                onClick={() => setConfirming(null)}
                className="underline"
              >
                Keep order
              </button>
            </div>
          ) : order.payment_status === 'unpaid' &&
            ['pending', 'processing'].includes(order.shipping_status ?? '') ? (
            <button
              type="button"
              disabled={
                submitting ||
                scope.cancellationUncertain ||
                scope.isCancellationBlocked(order.id)
              }
              onClick={() => setConfirming(order.id)}
              className="mt-2 block underline"
            >
              Cancel order {order.order_number ?? ''}
            </button>
          ) : null}
        </div>
      ))}
      {hasMoreOrders && orders && (
        <p className="mt-2">
          <a
            className="underline"
            href={joinRouteBasePath(basePath, '/account/orders')}
          >
            View all orders
          </a>
        </p>
      )}
    </section>
  );
}
