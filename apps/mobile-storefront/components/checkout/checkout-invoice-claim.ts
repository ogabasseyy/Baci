import { claimCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-tracking';
import { trackCheckoutInvoiceGenerated } from '@/services/analytics';
import { serializeAfterOrderCreated } from '@/services/serialize-after-order-created';
import type { CartItem } from '@/stores/cart-store';
import type { PaymentMethodType } from './PaymentMethodSelector';

interface MaybeClaimCheckoutInvoiceParams {
  selectedPayment: PaymentMethodType | null;
  order: { id: string; payment_status?: string; total: number };
  orderNumber: string;
  itemsSnapshot: CartItem[];
}

/**
 * Claims the invoice_generated funnel event for unpaid invoice orders.
 * A fully covered invoice selection comes back paid with nothing due:
 * claiming invoice_generated would book a proforma conversion for an
 * order that routes straight to paid completion. Gates only on the
 * authoritative unpaid state: a zero-total invoice (e.g. 100% discount)
 * still generates and emails a proforma, so requiring a positive amount
 * due would create a false funnel drop-off. Extracted from
 * use-checkout-submit (300-line file limit).
 */
export async function maybeClaimCheckoutInvoice({
  selectedPayment,
  order,
  orderNumber,
  itemsSnapshot,
}: MaybeClaimCheckoutInvoiceParams): Promise<void> {
  const isUnpaidInvoiceOrder = order.payment_status !== 'paid';
  if (selectedPayment !== 'invoice' || !isUnpaidInvoiceOrder) {
    return;
  }
  // Chain behind the order-created emission so the funnel keeps
  // causal order even though creation is recorded fire-and-forget.
  await serializeAfterOrderCreated(order.id, async () => {
    if (!(await claimCheckoutPurchaseTracking(order.id, 'invoice_generated'))) {
      return;
    }
    trackCheckoutInvoiceGenerated({
      itemCount: itemsSnapshot.reduce(
        (count, item) => count + item.quantity,
        0
      ),
      orderId: order.id,
      orderNumber,
      paymentMethod: 'invoice',
      total: order.total,
    });
  });
}
