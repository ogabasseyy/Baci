'use client';

import { motion } from 'framer-motion';
import { ArrowRight, HandCoins, Package } from 'lucide-react';
import Link from 'next/link';
import { asRoute } from '@/lib/routes';

interface CheckoutReconciliationViewProps {
  orderNumber: string | null;
  getHref: (path: string) => string;
}

/**
 * Captured-but-cancelled/refunded outcome: the provider took the money but
 * the finalizer left no active paid order (a reconciliation review was
 * filed). The shopper sees the refund/reconciliation state — never a
 * confirmed order — with the cart intact for a fresh attempt.
 */
export function CheckoutReconciliationView({
  orderNumber,
  getHref,
}: CheckoutReconciliationViewProps) {
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
          Payment Received — Order Under Review
        </h1>
        {orderNumber && (
          <p className="font-mono font-bold text-store-background-text mb-3">
            #{orderNumber}
          </p>
        )}
        <p className="text-store-background-text/70 mb-6">
          Your payment went through, but this order was cancelled before it
          could be confirmed. Our team is reconciling it now — any amount due
          back to you will be refunded automatically.
        </p>

        <div className="bg-store-secondary border border-store-border rounded-2xl p-4 mb-6">
          <p className="text-sm text-store-secondary-text">
            No action needed. Your cart is still intact if you&apos;d like to
            place a fresh order.
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
