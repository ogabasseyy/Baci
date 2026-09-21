'use client';

import {
  ArrowRight,
  Check,
  Copy,
  Download,
  FileText,
  Share2,
  ShoppingBag,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type React from 'react';
import { useEffect, useState } from 'react';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { BACI_GOOGLE_REVIEW_URL } from '@/lib/post-purchase-actions';
import { InvoiceModal } from '../components/InvoiceModal';
import { useV2Order } from '../providers/v2-order-context';

// Hook to extract store slug from pathname
function useStoreSlug() {
  const pathname = usePathname();
  const pathSegments = pathname?.split('/').filter(Boolean) || [];
  const knownRoutes = ['account', 'cart', 'checkout', 'products', 'wishlist', 'wallet', 'repairs', 'imei-check', 'pages', 'orders'];
  const firstSegment = pathSegments[0] || '';
  return knownRoutes.includes(firstSegment) ? '' : firstSegment;
}


const GoogleIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

export const OrderSuccessPage: React.FC = () => {
  const router = useRouter();
  const { getOrder } = useV2Order();
  const { isAuthenticated } = useCustomerAuth();
  const searchParams = useSearchParams();
  const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);
  const [payerLinkCopied, setPayerLinkCopied] = useState(false);

  const storeSlug = useStoreSlug();
  const getUrl = (path: string) => storeSlug ? `/${storeSlug}${path}` : path;

  const orderId = searchParams.get('orderId');
  const trackingToken = searchParams.get('trackingToken');
  const successType = searchParams.get('type') || 'standard'; // standard, invoice, payforme
  const payerName = searchParams.get('payerName') || 'Friend';
  const isBnplSuccess = ['credit_direct', 'credpal', 'klump'].includes(
    successType
  );

  const order = orderId ? getOrder(orderId) : undefined;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Pay for Me handoff contract: nothing is delivered to the payer
  // contact server-side — the requester's email carries the transfer
  // details to forward, and this page hands them the shareable payment
  // link. The copy must never claim a delivery happened.
  const payerPaymentLink =
    successType === 'payforme' && trackingToken
      ? `${window.location.origin}${getUrl(`/track-order?token=${trackingToken}`)}`
      : null;

  const getTitle = () => {
    if (successType === 'invoice') return 'Proforma Invoice Ready!';
    if (successType === 'payforme') return 'Share the Payment Link';
    if (isBnplSuccess) return 'BNPL Checkout Submitted';
    return 'Order Successful!';
  };

  const getMessage = () => {
    if (successType === 'invoice')
      return 'Your proforma invoice is ready to share with your company or procurement team.';
    if (successType === 'payforme')
      return `Send the payment link below to ${payerName} — your order will be processed once payment is received.`;
    if (isBnplSuccess)
      return 'We will confirm your order after the provider approves the payment. You can track this order while approval is pending.';
    return 'Thank you for shopping with Ogabassey. Your receipt will be available for download after your order has been shipped.';
  };

  const getIcon = () => {
    if (successType === 'invoice')
      return <FileText className="text-blue-600 size-10" />;
    if (successType === 'payforme')
      return <Share2 className="text-purple-600 size-10" />;
    return <ShoppingBag className="text-green-600 size-10" />;
  };

  const getBgColor = () => {
    if (successType === 'invoice') return 'bg-blue-50 border-blue-200';
    if (successType === 'payforme') return 'bg-purple-50 border-purple-200';
    return 'bg-green-50 border-white';
  };

  if (!order && !orderId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 flex-col gap-4">
        <p>Order not found</p>
        <Link href={getUrl('/') as any} className="text-store-primary font-bold hover:underline">
          Return Home
        </Link>
      </div>
    );
  }

  // If we don't have the order object (e.g. strict ID look up failed or passed via state which we don't have),
  // we might render based on params or generic success.
  // For now let's assume getOrder works or we fallback gracefully.
  // Actually, the original code used `orderDetails` from state for invoice type.
  // We should try to get it from context.

  const displayOrder = order;

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 pb-32 text-center">
      {/* Success Illustration */}
      <div className="mb-8 relative">
        <div
          className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 relative z-10 animate-in zoom-in duration-500 border-4 ${getBgColor()}`}
        >
          {getIcon()}
          <div className="absolute -bottom-1 -right-1 bg-green-500 text-white p-1.5 rounded-full border-4 border-white shadow-sm">
            <Check size={16} strokeWidth={4} />
          </div>
        </div>

        {/* Confetti Effect Background */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-48 bg-green-100/50 rounded-full blur-3xl -z-10" />
      </div>

      {/* Content */}
      <div className="max-w-md w-full animate-in slide-in-from-bottom-5 duration-500 fade-in fill-mode-forwards">
        <p className="text-gray-400 font-mono text-sm font-bold mb-2 tracking-widest uppercase">
          Order #{orderId}
        </p>
        <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-4">
          {getTitle()}
        </h1>
        <p className="text-gray-600 leading-relaxed mb-8 text-sm md:text-base">
          {getMessage()}
        </p>

        {/* Payer handoff (Pay for Me only): the shareable payment link the
            requester forwards — nothing is sent to the payer for them. */}
        {successType === 'payforme' && payerPaymentLink && (
          <div className="mb-10 rounded-2xl border border-purple-200 bg-purple-50 p-4 text-left">
            <p className="text-xs font-bold uppercase tracking-widest text-purple-600 mb-2">
              Payment link for {payerName}
            </p>
            <div className="flex items-center gap-2">
              <input
                aria-label="Payment link to share with your payer"
                readOnly
                value={payerPaymentLink}
                onFocus={(event) => event.target.select()}
                className="min-w-0 flex-1 truncate rounded-lg border border-purple-200 bg-white px-3 py-2.5 text-sm text-gray-700"
              />
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(payerPaymentLink)
                    .then(
                      () => setPayerLinkCopied(true),
                      () => setPayerLinkCopied(false)
                    );
                }}
                className="shrink-0 rounded-lg bg-store-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-store-primary/90 active:scale-[0.98] flex items-center gap-2"
              >
                {payerLinkCopied ? (
                  <Check size={16} />
                ) : (
                  <Copy size={16} />
                )}
                {payerLinkCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {/* Download Proforma Invoice Button (Only for Invoice Mode) */}
        {successType === 'invoice' && displayOrder && (
          <div className="mb-10">
            <button type="button"
              onClick={() => setIsInvoiceOpen(true)}
              className="w-full bg-store-primary hover:bg-store-primary/90 text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-lg hover:shadow-store-primary/20 flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              <Download size={20} /> Download Proforma Invoice
            </button>
            <p className="text-xs text-gray-400 mt-2">
              PDF format • {displayOrder.total}
            </p>
          </div>
        )}

        {/* Review Card */}
        <div className="bg-gray-50 rounded-2xl p-6 md:p-8 border border-gray-100 mb-8 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-4 text-lg">
            Loved the experience? 🥺
          </h3>
          <a
            href={BACI_GOOGLE_REVIEW_URL}
            target="_blank"
            rel="noreferrer"
            className="bg-white border border-gray-200 text-gray-700 font-bold py-3 px-6 rounded-xl hover:border-gray-300 hover:bg-gray-50 transition-all flex items-center justify-center gap-3 w-full shadow-sm group"
          >
            <GoogleIcon className="size-5 group-hover:scale-110 transition-transform" />
            Leave a Google Review
          </a>
        </div>

        <p className="text-store-primary font-bold italic mb-8 flex items-center justify-center gap-2">
          <span className="w-8 h-px bg-red-200" />
          Ogabassey never disappoints ✨
          <span className="w-8 h-px bg-red-200" />
        </p>

        <div className="flex flex-col-reverse md:flex-row gap-3 justify-center">
          <Link
            href={getUrl('/') as any}
            className="flex-1 py-3.5 px-6 rounded-xl font-bold text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
          >
            Continue Shopping
          </Link>
          <button type="button"
            onClick={() => {
              if (!isAuthenticated && trackingToken) {
                router.push(getUrl(`/track-order?token=${trackingToken}`) as any);
              } else {
                router.push(getUrl('/account/orders') as any);
              }
            }}
            className="flex-1 bg-store-primary text-white font-bold py-3.5 px-6 rounded-xl hover:bg-store-primary/90 transition-all shadow-lg hover:shadow-store-primary/20 active:scale-[0.98] flex items-center justify-center gap-2"
          >
            See Order Details <ArrowRight size={18} />
          </button>
        </div>
      </div>

      <InvoiceModal
        isOpen={isInvoiceOpen}
        onClose={() => setIsInvoiceOpen(false)}
      />
    </div>
  );
};
