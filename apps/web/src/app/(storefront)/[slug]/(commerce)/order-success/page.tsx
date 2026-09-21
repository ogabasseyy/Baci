'use client';

import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
} from '@baci/shared/contracts';
import { ArrowRight, CheckCircle, Download, Loader2, Star } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCurrencyWithCountry } from '@/hooks/use-currency';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { BACI_GOOGLE_REVIEW_URL } from '@/lib/post-purchase-actions';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import { asRoute } from '@/lib/routes';

interface OrderData {
  id: string;
  order_number: string;
  short_id?: string;
  tracking_token?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  shipping_address?: Record<string, unknown>;
  payment_status?: string;
  payment_method?: string;
  shipping_status?: string;
  merchant_id?: string;
  currency?: string;
  items: Array<{
    id: string;
    product_name?: string;
    name?: string;
    gtin?: string | null;
    price: number;
    quantity: number;
    product_images?: string[];
  }>;
  subtotal: number;
  shipping_cost: number;
  total: number;
}

import { GoogleCustomerReviews } from '@/components/analytics/google-customer-reviews';
import { useAuthSafe } from '@/contexts/auth-context';

// Default to 5 days for delivery logic if not available
const DELIVERY_ESTIMATE_MS = 5 * 24 * 60 * 60 * 1000;

// CredPal and Klump approve asynchronously: the launcher navigates here
// while the order is still pending, so the success path polls the
// token-scoped order until the provider webhook marks it paid. Two lanes:
// a fast lane for the first minute (webhooks usually land quickly), then
// a slow lane so approvals settling minutes later still update the page
// while the shopper waits. Bounded so a guest waiting on a slow approval
// is never stuck polling forever.
const PENDING_BNPL_TYPES = ['credpal', 'klump'] as const;
type PendingBnplType = (typeof PENDING_BNPL_TYPES)[number];
const BNPL_SETTLEMENT_POLL_INTERVAL_MS = 3000;
const BNPL_SETTLEMENT_FAST_POLL_ATTEMPTS = 20;
const BNPL_SETTLEMENT_SLOW_POLL_INTERVAL_MS = 15000;
const BNPL_SETTLEMENT_POLL_MAX_ATTEMPTS = 40;

function isPendingBnplType(value: string | null): value is PendingBnplType {
  return (
    value !== null && (PENDING_BNPL_TYPES as readonly string[]).includes(value)
  );
}

function capturePendingBnplSettlement({
  orderId,
  orderNumber,
  paymentMethod,
  reference,
  total,
  currency,
}: {
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  reference?: string;
  total?: number;
  currency?: string;
}): void {
  // Inside a native BNPL WebView the native shell owns conversion
  // attribution (with native-verified outcomes): emitting here would
  // double-attribute every web completion event.
  if (
    typeof window !== 'undefined' &&
    (window as { ReactNativeWebView?: unknown }).ReactNativeWebView
  ) {
    return;
  }
  captureCheckoutFunnelEventOnce(
    CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
    orderId,
    buildCheckoutFunnelProperties({
      channel: 'web',
      currency,
      orderId,
      orderNumber,
      paymentIntent: 'installments',
      paymentMethod,
      paymentStatus: 'paid',
      reference,
      source: 'web_checkout',
      total,
    })
  );
}

async function fetchOrderData(
  orderId: string,
  merchantSlug: string | undefined,
  orderToken: string | null,
  lookupEmail: string | null = null
): Promise<OrderData | null> {
  try {
    const query = new URLSearchParams();
    if (merchantSlug) query.set('merchant_slug', merchantSlug);
    if (orderToken) query.set('token', orderToken);
    if (!orderToken && lookupEmail) query.set('email', lookupEmail);
    const url = query.toString()
      ? `/api/storefront/orders/${orderId}?${query.toString()}`
      : `/api/storefront/orders/${orderId}`;

    // Use storefront endpoint (guest-accessible, token-based)
    const res = await fetch(url);
    if (res.ok) {
      return (await res.json()) as OrderData;
    }
  } catch (err) {
    console.error('Failed to fetch order', err);
  }

  return null;
}

function OrderSuccessContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('orderId');
  const orderToken =
    searchParams.get('trackingToken') || searchParams.get('token');
  // Guest orders confirmed via email-only lookup (no tracking token) pass
  // the email through so the order fetch below can still authenticate.
  const lookupEmail = searchParams.get('email');
  const _type = searchParams.get('type'); // Reserved for future use
  const bnplType = isPendingBnplType(_type) ? _type : null;
  // The standard CredPal pending redirect carries the provider
  // transaction as `credpalRef` (see the place-order CredPal handler),
  // not `reference`: accept the alias so the later settlement capture
  // can reconcile the deferred conversion to the provider transaction.
  const bnplReference =
    searchParams.get('reference') || searchParams.get('credpalRef');
  const merchantContext = useMerchantSafe();
  const basePath = merchantContext?.basePath;
  const merchant = merchantContext?.merchant;
  const { formatCurrency } = useCurrencyWithCountry(
    merchant?.country,
    merchant?.payout_currency
  );
  const auth = useAuthSafe();
  const user = auth?.user;

  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [estimatedDeliveryDate] = useState(
    () =>
      new Date(Date.now() + DELIVERY_ESTIMATE_MS).toISOString().split('T')[0]
  );

  // Helper for dynamic links
  const getHref = (path: string) =>
    path.startsWith('http')
      ? path
      : `${basePath || ''}${path === '/' ? '' : path}`;

  useEffect(() => {
    if (!orderId) {
      return;
    }

    fetchOrderData(orderId, merchant?.slug, orderToken, lookupEmail).then(
      (data) => {
        if (data) {
          setOrder(data);
        }
        setLoading(false);
      }
    );
  }, [orderId, merchant?.slug, orderToken, lookupEmail]);

  // Pending BNPL approvals settle via webhook after navigation: keep
  // polling the token-scoped order until it reads paid, then capture the
  // conversion the launcher deliberately skipped. Revisits/refreshes are
  // safe: capture is once-guarded per order.
  const orderPaymentStatus = order?.payment_status;
  const needsSettlementPoll =
    bnplType !== null &&
    Boolean(orderId && orderToken) &&
    !loading &&
    orderPaymentStatus !== 'paid';
  useEffect(() => {
    if (!needsSettlementPoll || !orderId || !bnplType) {
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    const scheduleNext = () => {
      const interval =
        attempts < BNPL_SETTLEMENT_FAST_POLL_ATTEMPTS
          ? BNPL_SETTLEMENT_POLL_INTERVAL_MS
          : BNPL_SETTLEMENT_SLOW_POLL_INTERVAL_MS;
      timer = setTimeout(() => {
        timer = undefined;
        void pollSettlement();
      }, interval);
    };
    // Serialized: the next poll is scheduled only after the current fetch
    // settles, so a slow older pending response can never arrive after a
    // newer paid response and overwrite the settled order (which would
    // also suppress the completion capture).
    const pollSettlement = async () => {
      if (cancelled || inFlight) {
        return;
      }
      inFlight = true;
      attempts += 1;
      let data: OrderData | null = null;
      try {
        data = await fetchOrderData(orderId, merchant?.slug, orderToken, null);
      } finally {
        inFlight = false;
      }
      if (cancelled) {
        return;
      }
      if (data) {
        setOrder(data);
      }
      if (
        data?.payment_status === 'paid' ||
        attempts >= BNPL_SETTLEMENT_POLL_MAX_ATTEMPTS
      ) {
        return;
      }
      scheduleNext();
    };
    // The shopper returned while a slow-lane wait was pending: revalidate
    // now instead of making them wait out the backoff.
    const revalidateOnVisible = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      if (cancelled || inFlight || timer === undefined) {
        return;
      }
      stop();
      void pollSettlement();
    };
    window.addEventListener('focus', revalidateOnVisible);
    document.addEventListener('visibilitychange', revalidateOnVisible);
    scheduleNext();
    return () => {
      cancelled = true;
      stop();
      window.removeEventListener('focus', revalidateOnVisible);
      document.removeEventListener('visibilitychange', revalidateOnVisible);
    };
  }, [needsSettlementPoll, orderId, orderToken, merchant?.slug, bnplType]);

  // Captures the pending-to-paid BNPL transition observed on this path
  // (including an already-paid first read the launcher's single check may
  // have raced). Immediate-paid launcher captures dedupe via the
  // once-guard, so this never double-counts within a session.
  useEffect(() => {
    // Identity-gate the capture: same-route navigation to another order
    // while the first lookup is in flight leaves the previous (possibly
    // paid) order in state, and claiming for the new orderId from the
    // stale order would both misattribute and — via the once-guard —
    // suppress the correct capture when the new lookup resolves.
    if (
      !bnplType ||
      !orderId ||
      !order ||
      order.id !== orderId ||
      order.payment_status !== 'paid'
    ) {
      return;
    }
    const settledTotal = Number(order.total);
    // Stamped order currency: a merchant that changed payout currency
    // after the order must not relabel this deferred completion.
    const settledCurrency =
      typeof order.currency === 'string' && order.currency.trim()
        ? order.currency.trim().toUpperCase()
        : undefined;
    capturePendingBnplSettlement({
      orderId,
      orderNumber: order.order_number || order.short_id,
      paymentMethod: order.payment_method || bnplType,
      reference: bnplReference ?? undefined,
      ...(Number.isFinite(settledTotal) ? { total: settledTotal } : {}),
      ...(settledCurrency ? { currency: settledCurrency } : {}),
    });
  }, [bnplType, orderId, order, bnplReference]);

  // Without an order id there is nothing to fetch, so we are never loading.
  const isLoading = loading && Boolean(orderId);
  const hasValidatedOrder = Boolean(order);
  const hasRecoveryState = !isLoading && !hasValidatedOrder;
  // Invoice-method detection stays true after payment so a paid invoice
  // order keeps its commercial (380) document action; proforma
  // presentation is unpaid-only, matching resolveInvoiceTypeCode.
  const isInvoiceMethod =
    _type === 'invoice' ||
    order?.payment_status === 'invoice' ||
    order?.payment_method === 'invoice';
  const isInvoice = isInvoiceMethod && order?.payment_status !== 'paid';

  const heading = hasValidatedOrder
    ? isInvoice
      ? 'Proforma Invoice Ready!'
      : 'Order Confirmed!'
    : hasRecoveryState
      ? 'We could not confirm this order yet'
      : 'Finalizing your order';
  const description = hasValidatedOrder
    ? isInvoice
      ? 'We have prepared your proforma invoice and sent it to your email. Share it with your company or procurement team.'
      : 'Thank you for your purchase. Your order has been received.'
    : hasRecoveryState
      ? 'We could not validate this order from the current link. You can return to checkout or keep shopping while we sort it out.'
      : 'We are validating your order details now. This page will update as soon as your confirmation is ready.';
  const googleCustomerReviewProducts =
    order?.items
      .map((item) => item.gtin?.trim())
      .filter((gtin): gtin is string => Boolean(gtin))
      .map((gtin) => ({ gtin })) ?? [];

  return (
    <div className="min-h-screen bg-gray-50 pb-20 pt-10">
      {/* Google Customer Reviews Opt-in */}
      {merchant && order?.customer_email && (
        <GoogleCustomerReviews
          merchant={merchant}
          orderId={order.id}
          email={order.customer_email}
          deliveryDate={estimatedDeliveryDate}
          country={merchant.country || 'NG'}
          products={googleCustomerReviewProducts}
        />
      )}

      <div className="max-w-xl mx-auto px-4">
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 text-center">
          <div
            className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${
              hasValidatedOrder
                ? 'bg-green-100'
                : hasRecoveryState
                  ? 'bg-amber-100'
                  : 'bg-gray-100'
            }`}
          >
            {hasValidatedOrder ? (
              <CheckCircle className="size-10 text-green-600" />
            ) : (
              <Loader2
                className={`size-10 ${
                  hasRecoveryState
                    ? 'text-amber-600'
                    : 'animate-spin text-gray-500'
                }`}
              />
            )}
          </div>

          <h1 className="text-3xl font-bold text-gray-900 mb-2">{heading}</h1>
          <p className="text-gray-500 mb-8">{description}</p>

          {isLoading && (
            <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-500 mb-8">
              <Loader2 className="size-4 animate-spin" />
              <span>Fetching your order summary…</span>
            </div>
          )}

          {order && (
            <div className="text-left bg-gray-50 rounded-2xl p-6 mb-8 border border-gray-100">
              <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-200">
                <span className="text-sm font-medium text-gray-500">
                  Order Number
                </span>
                <span className="font-bold text-gray-900">
                  #{order.order_number || order.id.slice(0, 8)}
                </span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-start">
                  <span className="text-sm font-medium text-gray-500">
                    Items ({order.items?.length || 0})
                  </span>
                  <span className="font-medium text-gray-900">
                    {formatCurrency(order.total)}
                  </span>
                </div>
                {order.customer_email && (
                  <div className="flex justify-between items-start">
                    <span className="text-sm font-medium text-gray-500">
                      Email
                    </span>
                    <span className="font-medium text-gray-900 truncate max-w-[200px]">
                      {order.customer_email}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {hasRecoveryState && (
              <Link
                href={asRoute(getHref('/checkout'))}
                className="inline-flex items-center justify-center gap-2 px-6 py-4 bg-black text-white font-bold rounded-xl hover:bg-gray-800 transition-colors w-full"
              >
                Return to Checkout
                <ArrowRight size={18} />
              </Link>
            )}

            {isInvoiceMethod && (
              <Link
                href={asRoute(getHref('/receipts'))}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-store-border bg-store-background px-6 py-4 font-bold text-store-background-text transition-colors hover:bg-store-secondary"
              >
                <Download size={18} />
                {isInvoice
                  ? 'Download Proforma Invoice PDF'
                  : 'Download Commercial Invoice PDF'}
              </Link>
            )}

            <Link
              href={asRoute(getHref('/'))}
              className={`inline-flex items-center justify-center gap-2 px-6 py-4 font-bold rounded-xl transition-colors w-full ${
                hasRecoveryState
                  ? 'bg-white text-gray-900 border border-gray-200 hover:bg-gray-50'
                  : 'bg-black text-white hover:bg-gray-800'
              }`}
            >
              Continue Shopping
              <ArrowRight size={18} />
            </Link>

            {hasValidatedOrder && user ? (
              <Link
                href={asRoute(getHref('/account/orders'))}
                className="inline-flex items-center justify-center gap-2 px-6 py-4 bg-white text-gray-900 font-bold rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors w-full"
              >
                View My Orders
              </Link>
            ) : hasValidatedOrder && order?.tracking_token ? (
              <Link
                href={asRoute(
                  getHref(
                    `/track-order?token=${encodeURIComponent(order.tracking_token)}`
                  )
                )}
                className="inline-flex items-center justify-center gap-2 px-6 py-4 bg-white text-gray-900 font-bold rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors w-full"
              >
                Track My Order
              </Link>
            ) : null}

            {hasValidatedOrder && (
              <a
                href={BACI_GOOGLE_REVIEW_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-4 bg-white text-gray-900 font-bold rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors w-full"
              >
                <Star size={18} />
                Leave a Google Review
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OrderSuccessPage() {
  return <OrderSuccessContent />;
}
