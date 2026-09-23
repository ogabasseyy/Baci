'use client';

import { ArrowRight, CheckCircle, Loader2, Star } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GoogleCustomerReviews } from '@/components/analytics/google-customer-reviews';
import { useAuthSafe } from '@/contexts/auth-context';
import { useCurrencyWithCountry } from '@/hooks/use-currency';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { BACI_GOOGLE_REVIEW_URL } from '@/lib/post-purchase-actions';
import { asRoute } from '@/lib/routes';
import {
  fetchStorefrontOrderData,
  type StorefrontOrderData as OrderData,
} from './fetch-storefront-order';
import { OrderSuccessInvoiceCta } from './order-success-invoice-cta';
import { OrderSuccessOrderSummary } from './order-success-order-summary';
import { buildPayerHandoff } from './order-success-payer-handoff';
import { OrderSuccessPayerHandoff } from './order-success-payer-handoff-view';
import {
  buildGoogleReviewProducts,
  buildOrderSuccessCopy,
  resolveInvoicePresentation,
} from './order-success-presentation';
import { useBnplSettlement } from './use-bnpl-settlement';

// Default to 5 days for delivery logic if not available
const DELIVERY_ESTIMATE_MS = 5 * 24 * 60 * 60 * 1000;

function OrderSuccessContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('orderId');
  const orderToken =
    searchParams.get('trackingToken') || searchParams.get('token');
  // Guest orders confirmed via email-only lookup (no tracking token) pass
  // the email through so the order fetch below can still authenticate.
  const lookupEmail = searchParams.get('email');
  const _type = searchParams.get('type');
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
  const [payerDetailsCopied, setPayerDetailsCopied] = useState(false);
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

    // Same-route navigation (order A → order B) reuses this component
    // without remounting: clear the rendered order so A's details —
    // especially the Pay for Me payer handoff — are never shown or
    // copied under B's URL while B's lookup is in flight or fails.
    setOrder(null);
    setPayerDetailsCopied(false);
    setLoading(true);
    let cancelled = false;
    fetchStorefrontOrderData(
      orderId,
      merchant?.slug,
      orderToken,
      lookupEmail
    ).then((data) => {
      // A superseded lookup resolving late must not overwrite the
      // current identity's state (or suppress its loading UI).
      if (cancelled) {
        return;
      }
      if (data) {
        setOrder(data);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [orderId, merchant?.slug, orderToken, lookupEmail]);

  useBnplSettlement({
    checkoutType: _type,
    orderId,
    orderToken,
    merchantSlug: merchant?.slug,
    referenceParam: searchParams.get('reference'),
    credpalRefParam: searchParams.get('credpalRef'),
    loading,
    order,
    setOrder,
  });

  // Without an order id there is nothing to fetch, so we are never loading.
  const isLoading = loading && Boolean(orderId);
  const hasValidatedOrder = Boolean(order);
  const hasRecoveryState = !isLoading && !hasValidatedOrder;
  const { isInvoice, isInvoiceMethod } = resolveInvoicePresentation({
    order,
    type: _type,
  });
  const payerHandoff = buildPayerHandoff({
    merchantCountry: merchant?.country,
    order,
    payerNameParam: searchParams.get('payerName'),
    type: _type,
  });
  const { isPayForMeUnpaid, payerName } = payerHandoff;
  const { description, heading } = buildOrderSuccessCopy({
    hasRecoveryState,
    hasValidatedOrder,
    isInvoice,
    isPayForMeUnpaid,
    payerName,
  });
  const googleCustomerReviewProducts = buildGoogleReviewProducts(order);

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

          {/* Payer handoff (Pay for Me only): copyable payment
              instructions the requester forwards — amount plus transfer
              details, with no bearer token, no link, and no PII. */}
          {order && (
            <OrderSuccessPayerHandoff
              handoff={payerHandoff}
              order={order}
              payerDetailsCopied={payerDetailsCopied}
              onCopied={setPayerDetailsCopied}
            />
          )}
          {isLoading && (
            <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-500 mb-8">
              <Loader2 className="size-4 animate-spin" />
              <span>Fetching your order summary…</span>
            </div>
          )}

          {order && (
            <OrderSuccessOrderSummary
              formatCurrency={formatCurrency}
              order={order}
            />
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
              <OrderSuccessInvoiceCta
                archiveHref={asRoute(getHref('/receipts'))}
                isAuthed={Boolean(user)}
                isInvoice={isInvoice}
                merchantSlug={merchant?.slug}
                order={order}
              />
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
