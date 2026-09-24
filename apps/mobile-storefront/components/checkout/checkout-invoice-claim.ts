import {
  claimCheckoutPurchaseTracking,
  markCheckoutPurchaseEmitted,
} from '@/lib/claim-checkout-purchase-tracking';
import { trackCheckoutInvoiceGenerated } from '@/services/analytics';
import { serializeAfterOrderCreated } from '@/services/serialize-after-order-created';
import type { PaymentMethodType } from './PaymentMethodSelector';

interface MaybeCaptureCheckoutInvoiceParams {
  selectedPayment: PaymentMethodType | null;
  order: {
    id: string;
    payment_status?: string;
    total: number;
    /** Stamped order currency for funnel attribution (absent keeps NGN). */
    currency?: string | null;
    /**
     * Terminal immediate-order after() delivery (invoice artifacts built
     * and proforma emailed), projected by the tracking lookup. The event
     * fires only on true: claiming it at creation would book a proforma
     * conversion for generation that may still fail.
     */
    notificationDelivered?: boolean | null;
    /**
     * Prior-payment evidence for wallet/savings-credited invoices (the
     * server emails those as commercial documents). Absent keeps the
     * legacy unpaid-only read.
     */
    amountPaid?: number | null;
    /** Shipping column for captured-but-shipping-cancelled orders. */
    shippingStatus?: string | null;
  };
  orderNumber: string;
  itemsSnapshot: Array<{ quantity: number }>;
}

function isCancelledStatus(value: unknown): boolean {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'cancelled' || normalized === 'canceled';
}

/**
 * Captures the invoice_generated funnel event for unpaid invoice orders
 * whose server-side artifact generation is confirmed delivered. A fully
 * covered invoice selection comes back paid with nothing due: capturing
 * invoice_generated would book a proforma conversion for an order that
 * routes straight to paid completion. Gates on the authoritative unpaid
 * state plus the terminal delivery flag: a zero-total invoice (e.g. 100%
 * discount) still generates and emails a proforma, so requiring a
 * positive amount due would create a false funnel drop-off. Extracted
 * from use-checkout-submit (300-line file limit).
 */
export async function maybeCaptureCheckoutInvoiceGenerated({
  selectedPayment,
  order,
  orderNumber,
  itemsSnapshot,
}: MaybeCaptureCheckoutInvoiceParams): Promise<void> {
  // Genuine-proforma predicate (mirrors the web order-success lane):
  // partially-paid, refunded, and cancelled orders are emailed as
  // commercial documents or are no longer payable, and a positive
  // credited amount means prior wallet/savings payment. Treating every
  // non-paid status as a proforma would consume the durable analytics
  // claim for a commercial document and suppress nothing else.
  const credited = Number(order.amountPaid ?? 0);
  const isProformaInvoiceOrder =
    order.payment_status !== 'paid' &&
    order.payment_status !== 'refunded' &&
    order.payment_status !== 'partially_paid' &&
    !isCancelledStatus(order.payment_status) &&
    !isCancelledStatus(order.shippingStatus) &&
    !(Number.isFinite(credited) && credited > 0);
  if (
    selectedPayment !== 'invoice' ||
    !isProformaInvoiceOrder ||
    order.notificationDelivered !== true
  ) {
    return;
  }
  // Chain behind the order-created emission so the funnel keeps
  // causal order even though creation is recorded fire-and-forget.
  await serializeAfterOrderCreated(order.id, async () => {
    if (!(await claimCheckoutPurchaseTracking(order.id, 'invoice_generated'))) {
      return;
    }
    trackCheckoutInvoiceGenerated({
      // Stamped creation currency: the invoice stage must match the
      // creation event and server order for non-NGN stores.
      currency: order.currency ?? undefined,
      itemCount: itemsSnapshot.reduce(
        (count, item) => count + item.quantity,
        0
      ),
      orderId: order.id,
      orderNumber,
      paymentMethod: 'invoice',
      total: order.total,
    });
    // Emission proof for crash recovery: without it an aged lease reads
    // orphaned after a restart and the invoice event double-emits.
    await markCheckoutPurchaseEmitted(order.id, 'invoice_generated');
  });
}
