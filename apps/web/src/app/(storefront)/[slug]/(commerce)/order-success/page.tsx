'use client';

import { ArrowRight, CheckCircle, Download, Loader2, Star } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCurrencyWithCountry } from '@/hooks/use-currency';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { BACI_GOOGLE_REVIEW_URL } from '@/lib/post-purchase-actions';
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

  // Without an order id there is nothing to fetch, so we are never loading.
  const isLoading = loading && Boolean(orderId);
  const hasValidatedOrder = Boolean(order);
  const hasRecoveryState = !isLoading && !hasValidatedOrder;
  const isInvoice =
    _type === 'invoice' ||
    order?.payment_status === 'invoice' ||
    order?.payment_method === 'invoice';

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

            {isInvoice && (
              <Link
                href={asRoute(getHref('/receipts'))}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-store-border bg-store-background px-6 py-4 font-bold text-store-background-text transition-colors hover:bg-store-secondary"
              >
                <Download size={18} />
                Download Proforma Invoice PDF
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
