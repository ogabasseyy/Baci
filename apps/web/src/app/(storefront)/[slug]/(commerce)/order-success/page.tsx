'use client';

import {
  ArrowRight,
  Check,
  CheckCircle,
  Copy,
  Download,
  Loader2,
  Mail,
  Star,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GoogleCustomerReviews } from '@/components/analytics/google-customer-reviews';
import { useAuthSafe } from '@/contexts/auth-context';
import { useCurrencyWithCountry } from '@/hooks/use-currency';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { formatCurrency as formatCurrencyForCode } from '@/lib/currency';
import { BACI_GOOGLE_REVIEW_URL } from '@/lib/post-purchase-actions';
import { asRoute } from '@/lib/routes';
import {
  fetchStorefrontOrderData,
  type StorefrontOrderData as OrderData,
} from './fetch-storefront-order';
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

    fetchStorefrontOrderData(
      orderId,
      merchant?.slug,
      orderToken,
      lookupEmail
    ).then((data) => {
      if (data) {
        setOrder(data);
      }
      setLoading(false);
    });
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
  // Invoice-method detection stays true after payment so a paid invoice
  // order keeps its commercial (380) document action; proforma
  // presentation is unpaid-only, matching resolveInvoiceTypeCode.
  const isInvoiceMethod =
    _type === 'invoice' ||
    order?.payment_status === 'invoice' ||
    order?.payment_method === 'invoice';
  const isInvoice = isInvoiceMethod && order?.payment_status !== 'paid';
  // Pay for Me handoff contract: nothing is delivered to the payer
  // contact server-side, and the tracking token is a full-PII bearer —
  // sharing any link that carries it would disclose the requester's
  // email, phone, and shipping address to the payer. The handoff is
  // therefore copyable payment instructions (amount + transfer details)
  // with no token, no link, and no PII. The copy must never claim a
  // delivery happened.
  const isPayForMe = _type === 'payforme';
  const payerName = searchParams.get('payerName') || 'Friend';
  // Authoritative outstanding balance: wallet/savings credit applied at
  // creation is persisted onto the row (recordPreGatewayRedemption), so
  // the payer is asked for the residual — the same amount the server
  // provisioned the DVA and email for — never the full total again. A
  // paid order suppresses the handoff entirely.
  const payerOutstandingBalance = order
    ? Math.max(order.total - (order.amount_paid || 0), 0)
    : 0;
  const isPayForMeUnpaid =
    isPayForMe &&
    order?.payment_status !== 'paid' &&
    payerOutstandingBalance > 0;
  // Same DVA-compatibility rule as the order email: Paystack DVAs settle
  // in NGN only, so a foreign-currency quote never prints the naira
  // account beside a dollar amount.
  const payerDvaCompatible =
    !order?.currency || order.currency.trim().toUpperCase() === 'NGN';
  const payerTransferAccount =
    payerDvaCompatible &&
    order &&
    payerOutstandingBalance > 0 &&
    order.virtual_account?.account_number
      ? order.virtual_account
      : null;
  // The stamped historical currency wins over the merchant's current
  // payout currency: a USD order revisited after the merchant switches to
  // NGN must still ask the payer in dollars. Absent/invalid codes fall
  // back to the merchant-country config inside the formatter.
  const payerAmountText = order
    ? formatCurrencyForCode(
        payerOutstandingBalance,
        merchant?.country,
        undefined,
        order.currency
      )
    : '';
  const payerDetailsText =
    isPayForMeUnpaid && order
      ? [
          `Payment for order ${order.order_number}: ${payerAmountText}`,
          ...(payerTransferAccount
            ? [
                `Bank: ${payerTransferAccount.bank_name || 'See your order email'}`,
                `Account name: ${payerTransferAccount.account_name || 'See your order email'}`,
                `Account number: ${payerTransferAccount.account_number}`,
              ]
            : []),
        ].join('\n')
      : null;

  const heading = hasValidatedOrder
    ? isPayForMeUnpaid
      ? 'Share the Payment Details'
      : isInvoice
        ? 'Proforma Invoice Ready!'
        : 'Order Confirmed!'
    : hasRecoveryState
      ? 'We could not confirm this order yet'
      : 'Finalizing your order';
  const description = hasValidatedOrder
    ? isPayForMeUnpaid
      ? `Send the payment details below to ${payerName} — your order will be processed once payment is received.`
      : isInvoice
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

          {/* Payer handoff (Pay for Me only): copyable payment
              instructions the requester forwards — amount plus transfer
              details, with no bearer token, no link, and no PII. */}
          {isPayForMeUnpaid && payerDetailsText && order && (
            <div className="mb-8 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-left">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
                Payment details for {payerName}
              </p>
              <dl className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 space-y-1">
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Amount due</dt>
                  <dd className="font-bold text-gray-900">{payerAmountText}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Order</dt>
                  <dd className="font-mono font-bold text-gray-900">
                    {order.order_number}
                  </dd>
                </div>
                {payerTransferAccount && (
                  <>
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-500">Bank</dt>
                      <dd className="font-bold text-gray-900">
                        {payerTransferAccount.bank_name ||
                          'See your order email'}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-500">Account name</dt>
                      <dd className="font-bold text-gray-900">
                        {payerTransferAccount.account_name ||
                          'See your order email'}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-500">Account number</dt>
                      <dd className="font-mono font-bold text-gray-900">
                        {payerTransferAccount.account_number}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              {!payerTransferAccount && payerOutstandingBalance > 0 && (
                <p className="mt-2 text-xs text-gray-500">
                  Your order email has the full transfer details — forward them
                  to {payerName} along with the amount above.
                </p>
              )}
              <button
                type="button"
                aria-label="Copy payment details to share with your payer"
                onClick={() => {
                  void navigator.clipboard?.writeText(payerDetailsText).then(
                    () => setPayerDetailsCopied(true),
                    () => setPayerDetailsCopied(false)
                  );
                }}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2.5 text-sm font-bold text-white hover:bg-gray-800 active:scale-[0.98]"
              >
                {payerDetailsCopied ? <Check size={16} /> : <Copy size={16} />}
                {payerDetailsCopied ? 'Copied' : 'Copy details'}
              </button>
            </div>
          )}

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

            {/* The receipts archive requires an account: guests would
                only hit the login redirect, so they get the accurate
                email action. Unpaid guests hold the proforma PDF from the
                immediate invoice email; paid guests hold the order
                confirmation email — no commercial-invoice PDF is emailed
                on later gateway settlement, so the copy must not claim
                one was sent. */}
            {isInvoiceMethod &&
              (user ? (
                <Link
                  href={asRoute(getHref('/receipts'))}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-store-border bg-store-background px-6 py-4 font-bold text-store-background-text transition-colors hover:bg-store-secondary"
                >
                  <Download size={18} />
                  {isInvoice
                    ? 'Download Proforma Invoice PDF'
                    : 'Download Commercial Invoice PDF'}
                </Link>
              ) : (
                <div className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-6 py-4 text-sm font-medium text-gray-600">
                  <Mail size={18} />
                  {isInvoice
                    ? `Your proforma invoice PDF was sent to ${order?.customer_email || 'your email'}.`
                    : `Your order confirmation was sent to ${order?.customer_email || 'your email'}.`}
                </div>
              ))}

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
