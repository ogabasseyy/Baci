'use client';

import { motion } from 'framer-motion';
import { Download, FileText } from 'lucide-react';
import Link from 'next/link';
import { asRoute } from '@/lib/routes';

export function CheckoutOrderDocuments({
  isInvoice,
  getHref,
}: {
  isInvoice: boolean;
  getHref: (path: string) => string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.8 }}
      className="bg-linear-to-br from-gray-900 to-gray-800 rounded-3xl p-6 text-white"
    >
      <div className="flex items-start gap-4">
        <div className="size-12 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
          <FileText className="size-6 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-lg mb-1">Your Receipt & Invoice</h3>
          <p className="text-gray-300 text-sm mb-4">
            {isInvoice
              ? 'Your proforma invoice is ready to download and share with your company or procurement team.'
              : 'Your invoice is available from your order details in your account. Your receipt will appear there and in the documents archive once the order has shipped.'}
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href={asRoute(
                getHref(isInvoice ? '/receipts' : '/account/orders')
              )}
              className="inline-flex items-center justify-center gap-2 bg-white text-gray-900 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-100 transition-colors"
            >
              <Download className="size-4" />
              {isInvoice
                ? 'Download Proforma Invoice PDF'
                : 'View Order Documents'}
            </Link>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
