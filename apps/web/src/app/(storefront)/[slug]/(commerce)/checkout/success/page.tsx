'use client';

import { motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Package,
  ShoppingBag,
  Star,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { AdUnit } from '@/components/storefront/ogabassey/components/AdUnit';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { usePrivateSearchParamsState } from '@/hooks/use-private-search-params';
import { BACI_GOOGLE_REVIEW_URL } from '@/lib/post-purchase-actions';
import { asRoute } from '@/lib/routes';
import { CheckoutOrderDocuments } from './checkout-order-documents';
import { CheckoutOrderNextSteps } from './checkout-order-next-steps';
import { CheckoutOrderProgress } from './checkout-order-progress';
import { CheckoutReconciliationView } from './checkout-reconciliation-view';
import { CheckoutSuccessLoading } from './checkout-success-loading';
import { useCheckoutSuccessVerification } from './use-checkout-success-verification';

/**
 * 2025 Best Practice: Order Confirmation Page
 * - Clear status communication (Order Received vs Confirmed)
 * - Visual timeline/stepper showing order progress
 * - Receipt download info
 * - Mobile-first responsive design
 * - Micro-animations for engagement
 */

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<CheckoutSuccessLoading />}>
      <CheckoutSuccessContent />
    </Suspense>
  );
}

function CheckoutSuccessContent() {
  const { searchParams, isReady } = usePrivateSearchParamsState();
  const router = useRouter();
  const reference = searchParams.get('reference');
  const orderId = searchParams.get('orderId');
  const paymentMethodParam = searchParams.get('paymentMethod');
  const trackingToken = searchParams.get('trackingToken');
  const { clearCart } = useCart();
  const merchantContext = useMerchantSafe();
  const basePath = merchantContext?.basePath || '';
  const storeName = merchantContext?.merchant?.business_name || 'Store';

  const getHref = (path: string) =>
    path.startsWith('http') ? path : `${basePath}${path}`;

  const { status, isVerifying, orderNumber, paymentMethod } =
    useCheckoutSuccessVerification({
      merchantSlug: merchantContext?.merchant?.slug,
      orderId,
      paymentMethodParam,
      reference,
      trackingToken,
      clearCart,
      router,
      basePath,
      isReady,
    });

  // Failed State
  if (status === 'failed') {
    return (
      <div className="min-h-screen bg-linear-to-b from-red-50 to-white flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', delay: 0.1 }}
            className="size-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6"
          >
            <AlertCircle className="size-10 text-red-600" />
          </motion.div>

          <h1 className="text-2xl font-bold text-gray-900 mb-3">
            Payment Unsuccessful
          </h1>
          <p className="text-gray-600 mb-6">
            We couldn&apos;t process your payment. Don&apos;t worry, your cart
            is still intact.
          </p>

          <div className="bg-red-50 border border-red-100 rounded-2xl p-4 mb-6">
            <p className="text-sm text-red-700">
              Redirecting you back to checkout in a few seconds…
            </p>
          </div>

          <Link
            href={asRoute(getHref('/checkout'))}
            className="w-full inline-flex items-center justify-center gap-2 bg-red-600 text-white py-4 px-6 rounded-2xl font-semibold hover:bg-red-700 transition-all"
          >
            Try Again
            <ArrowRight className="size-5" />
          </Link>
        </motion.div>
      </div>
    );
  }

  // Captured-but-cancelled/refunded: reconciliation state, never success.
  if (
    status === 'reconciling' ||
    status === 'reversed' ||
    status === 'access_required' ||
    status === 'bank_offer_review' ||
    status === 'verification_unavailable'
  ) {
    return (
      <CheckoutReconciliationView
        orderNumber={orderNumber}
        getHref={getHref}
        outcome={status}
      />
    );
  }

  // Success & Pending States (main redesigned page)
  const isConfirmed = status === 'success';
  const isInvoice =
    paymentMethod === 'invoice' || searchParams.get('type') === 'invoice';

  return (
    <div className="min-h-screen bg-linear-to-b from-green-50/50 via-white to-gray-50">
      {/* Hero Section */}
      <div className="pt-12 pb-8 px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-2xl mx-auto text-center"
        >
          {/* Animated Checkmark */}
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
            className="relative size-24 mx-auto mb-6"
          >
            <div className="absolute inset-0 bg-linear-to-br from-green-400 to-green-600 rounded-full opacity-20 animate-pulse" />
            <div className="absolute inset-2 bg-linear-to-br from-green-500 to-green-600 rounded-full flex items-center justify-center shadow-lg">
              <CheckCircle2 className="size-12 text-white" />
            </div>
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-3xl md:text-4xl font-bold text-gray-900 mb-3"
          >
            {isConfirmed
              ? isInvoice
                ? 'Proforma Invoice Ready!'
                : 'Order Received!'
              : 'Order Being Processed'}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-lg text-gray-600 mb-2"
          >
            Thank you for shopping with {storeName}
          </motion.p>

          {orderNumber && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="inline-flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm border border-gray-100"
            >
              <span className="text-sm text-gray-500">Order</span>
              <span className="font-mono font-bold text-gray-900">
                #{orderNumber}
              </span>
            </motion.div>
          )}
        </motion.div>
      </div>

      {/* Main Content */}
      <div className="px-4 pb-12">
        <div className="max-w-2xl mx-auto space-y-6">
          {isVerifying && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="bg-white rounded-2xl border border-amber-100 p-4 shadow-sm"
            >
              <div className="flex items-center gap-3 text-amber-700">
                <Loader2 className="size-4 animate-spin" />
                <p className="text-sm font-medium">
                  Confirming your payment status…
                </p>
              </div>
            </motion.div>
          )}

          <CheckoutOrderProgress
            isConfirmed={isConfirmed}
            isInvoice={isInvoice}
          />

          <CheckoutOrderNextSteps isInvoice={isInvoice} />

          <CheckoutOrderDocuments isInvoice={isInvoice} getHref={getHref} />

          {/* Action Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9 }}
            className="flex flex-col sm:flex-row gap-4"
          >
            <Link
              href={asRoute(getHref('/'))}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-red-600 text-white py-4 px-6 rounded-2xl font-semibold hover:bg-red-700 transition-all shadow-lg shadow-red-600/25"
            >
              <ShoppingBag className="size-5" />
              Continue Shopping
            </Link>
            <Link
              href={asRoute(getHref('/account/orders'))}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-white text-gray-700 py-4 px-6 rounded-2xl font-semibold hover:bg-gray-50 transition-all border border-gray-200"
            >
              <Package className="size-5" />
              Track Order
            </Link>
            <a
              href={BACI_GOOGLE_REVIEW_URL}
              target="_blank"
              rel="noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-2 bg-white text-gray-700 py-4 px-6 rounded-2xl font-semibold hover:bg-gray-50 transition-all border border-gray-200"
            >
              <Star className="size-5" />
              Leave a Google Review
            </a>
          </motion.div>

          {/* Ad Placement: Post-Purchase Cross-Sell */}
          <div className="pt-4">
            <AdUnit placementKey="ORDER_SUCCESS_BANNER" />
          </div>

          {/* Help Section */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            className="text-center text-sm text-gray-500"
          >
            Need help?{' '}
            <Link
              href={asRoute(getHref('/contact'))}
              className="text-red-600 font-medium hover:underline"
            >
              Contact our support team
            </Link>
          </motion.p>
        </div>
      </div>
    </div>
  );
}
