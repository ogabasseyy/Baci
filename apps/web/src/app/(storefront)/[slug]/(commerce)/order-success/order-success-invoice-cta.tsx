import { Download, Mail } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { StorefrontOrderData as OrderData } from './fetch-storefront-order';
import { resolvePaidInvoiceDocument } from './order-success-presentation';

const CTA_CLASS =
  'inline-flex w-full items-center justify-center gap-2 rounded-xl border border-store-border bg-store-background px-6 py-4 font-bold text-store-background-text transition-colors hover:bg-store-secondary';

/**
 * Invoice-method document action. Unpaid orders keep the proforma
 * archive link; paid orders link directly at the document the
 * receipts archive offers (receipt once shipped/delivered, commercial
 * invoice otherwise) so the label never promises a document the
 * archive will not serve. Guests get the accurate email action
 * because the archive would only bounce them to login.
 */
export function OrderSuccessInvoiceCta({
  archiveHref,
  isAuthed,
  isDelivered,
  isInvoice,
  merchantSlug,
  order,
}: {
  archiveHref: Route;
  isAuthed: boolean;
  /**
   * Server-observed terminal delivery (notification_delivered): invoice
   * artifacts and email send in after(), after the first lookup. Claiming
   * "sent" before the flag lands races delivery — and a failed delivery
   * would leave a permanently false instruction for a guest with no
   * authenticated download fallback.
   */
  isDelivered: boolean;
  isInvoice: boolean;
  merchantSlug?: string | null;
  order: OrderData | null;
}) {
  if (!isAuthed) {
    const recipient = order?.customer_email || 'your email';
    // Only the proforma lane is delivery-gated: its artifacts build in
    // after(), after the first lookup. Other methods keep their existing
    // copy (unchanged behavior, out of scope for the delivery race).
    if (isInvoice && !isDelivered) {
      return (
        <div className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-store-border bg-store-secondary px-6 py-4 text-sm font-medium text-store-background-text/55">
          <Mail size={18} />
          {`Your proforma invoice PDF is being prepared — we'll email it to ${recipient} as soon as it's ready.`}
        </div>
      );
    }
    return (
      <div className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-store-border bg-store-secondary px-6 py-4 text-sm font-medium text-store-background-text/55">
        <Mail size={18} />
        {isInvoice
          ? `Your proforma invoice PDF was sent to ${recipient}.`
          : `Your order confirmation was sent to ${recipient}.`}
      </div>
    );
  }
  if (!isInvoice && order?.id && merchantSlug) {
    const paidDocument = resolvePaidInvoiceDocument({ order });
    return (
      <a
        href={`/api/storefront/account/orders/${order.id}/${paidDocument.kind}?merchantSlug=${encodeURIComponent(merchantSlug)}`}
        className={CTA_CLASS}
      >
        <Download size={18} />
        {paidDocument.label}
      </a>
    );
  }
  return (
    <Link href={archiveHref} className={CTA_CLASS}>
      <Download size={18} />
      {isInvoice
        ? 'Download Proforma Invoice PDF'
        : 'Download Commercial Invoice PDF'}
    </Link>
  );
}
