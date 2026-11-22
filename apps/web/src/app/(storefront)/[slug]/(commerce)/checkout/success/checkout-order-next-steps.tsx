'use client';

import { motion } from 'framer-motion';
import { Clock, Mail, Truck } from 'lucide-react';

export function CheckoutOrderNextSteps({ isInvoice }: { isInvoice: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.7 }}
      className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6"
    >
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
        What Happens Next?
      </h2>
      <div className="space-y-4">
        <div className="flex items-start gap-4">
          <div className="size-10 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
            <Mail className="size-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-1">
              {isInvoice ? 'Invoice Sent to Email' : 'Order Confirmation Email'}
            </h3>
            <p className="text-sm text-gray-600">
              {isInvoice
                ? "We've prepared your proforma invoice and sent it to your email. Share it with your company or procurement team."
                : "You'll receive an email with your order details and tracking information once your order is confirmed."}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <div className="size-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
            <Clock className="size-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-1">
              Order Processing
            </h3>
            <p className="text-sm text-gray-600">
              Our team will verify your payment and prepare your order for
              shipping. This usually takes 1-2 business days.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <div className="size-10 bg-purple-100 rounded-xl flex items-center justify-center shrink-0">
            <Truck className="size-5 text-purple-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-1">
              Shipping Updates
            </h3>
            <p className="text-sm text-gray-600">
              Once shipped, you&apos;ll receive SMS and email updates with
              real-time tracking information.
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
