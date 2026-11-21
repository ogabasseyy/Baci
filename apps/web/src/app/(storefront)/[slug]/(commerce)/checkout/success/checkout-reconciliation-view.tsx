'use client';

import { motion } from 'framer-motion';
import { ArrowRight, HandCoins, Package } from 'lucide-react';
import Link from 'next/link';
import { asRoute } from '@/lib/routes';

interface CheckoutReconciliationViewProps {
  orderNumber: string | null;
  getHref: (path: string) => string;
  outcome?: keyof typeof copy;
}

const copy = {
  reconciling: {
    title: 'Payment Received — Order Under Review',
    detail:
      'Your payment went through, but this order was cancelled before it could be confirmed. Our team is reconciling it now — any amount due back to you will be refunded automatically.',
    cart: "No action needed. Your cart is still intact if you'd like to place a fresh order.",
  },
  reversed: {
    title: 'Payment reversed',
    detail:
      'Paystack reported a reversal for this payment. Contact support with your order number if you need help checking the status.',
    cart: 'Your cart is still intact. Wait for the reversal to be confirmed before paying again.',
  },
  bank_offer_review: {
    title: 'Payment attempt under review',
    detail:
      'Paystack reported that this payment did not complete. We need to check the original attempt before you can pay again.',
    cart: 'Your cart is intact. Check your order status or contact support for help.',
  },
  verification_unavailable: {
    title: 'Payment verification unavailable',
    detail:
      'Refresh this page to check your payment again, or see your order status in your account.',
    cart: 'Check your payment status before starting another payment.',
  },
  access_required: {
    title: 'Sign in to check your payment',
    detail:
      'Open your orders on the store where you checked out and sign in with the email you used for the order.',
    cart: 'Check your order status or contact support before paying again.',
  },
};

/**
 * Captured-but-cancelled/refunded outcome: the provider took the money but
 * the finalizer left no active paid order (a reconciliation review was
 * filed). The shopper sees the refund/reconciliation state — never a
 * confirmed order — with the cart intact for a fresh attempt.
 */
export function CheckoutReconciliationView({
  orderNumber,
  getHref,
  outcome = 'reconciling',
}: CheckoutReconciliationViewProps) {
  const showOrderNumber =
    outcome !== 'verification_unavailable' && outcome !== 'access_required';
  // Storefront theme tokens throughout (never hardcoded palette): this
  // state must honor merchant palettes and dark-mode storefronts like the
  // rest of the checkout flow.
  return (
    <div className="min-h-screen bg-linear-to-b from-store-secondary to-store-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-store-background border border-store-border rounded-3xl shadow-2xl p-8 max-w-md w-full text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', delay: 0.1 }}
          className="size-20 bg-store-secondary rounded-full flex items-center justify-center mx-auto mb-6"
        >
          <HandCoins className="size-10 text-store-primary" />
        </motion.div>

        <h1 className="text-2xl font-bold text-store-background-text mb-3">
          {copy[outcome].title}
        </h1>
        {showOrderNumber && orderNumber && (
          <p className="font-mono font-bold text-store-background-text mb-3">
            #{orderNumber}
          </p>
        )}
        <p className="text-store-background-text/70 mb-6">
          {copy[outcome].detail}
        </p>

        <div className="bg-store-secondary border border-store-border rounded-2xl p-4 mb-6">
          <p className="text-sm text-store-secondary-text">
            {copy[outcome].cart}
          </p>
        </div>

        <Link
          href={asRoute(getHref('/account/orders'))}
          className="w-full inline-flex items-center justify-center gap-2 bg-store-primary text-store-on-primary py-4 px-6 rounded-2xl font-semibold hover:bg-store-primary/90 transition-all"
        >
          <Package className="size-5" />
          Track Order Status
        </Link>
        <Link
          href={asRoute(getHref('/contact'))}
          className="w-full mt-3 inline-flex items-center justify-center gap-2 py-3 text-store-background-text/70 font-medium hover:text-store-background-text transition-colors"
        >
          Contact our support team
          <ArrowRight className="size-5" />
        </Link>
      </motion.div>
    </div>
  );
}
