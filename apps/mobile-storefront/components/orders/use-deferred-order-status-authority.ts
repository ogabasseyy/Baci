import { useReceiptDetail } from '@/hooks/use-receipts';
import {
  type GuestInvoicePaymentState,
  useGuestInvoicePaidState,
} from './use-invoice-paid-state';

interface DeferredOrderStatusAuthorityInput {
  customer: unknown;
  needsDeferredStatus: boolean;
  orderId?: string;
  paymentMethod?: string;
  trackingToken?: string;
}

function isCancelledStatus(value: unknown): boolean {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'cancelled' || normalized === 'canceled';
}

export interface DeferredOrderStatusAuthority {
  guestInvoice: GuestInvoicePaymentState;
  isPaidOrder: boolean;
  receiptAmountPaid: number;
  /**
   * Cancelled on either path: the authenticated receipt lookup (either
   * status column, either spelling — cancellation paths commonly set
   * only shipping_status) or the guest token lookup (skipped for
   * signed-in shoppers, so the receipt is their only reporter).
   */
  isCancelledOrder: boolean;
  receiptPaymentMethod: string | undefined;
  receiptPaymentStatus: string | undefined;
  /**
   * Whether the deferred-order status may drive purchase-success side
   * effects. An authenticated receipt lookup is authoritative only on a
   * successful result — a failed request must not render a paid or
   * refunded order as unpaid while enabling the notification and
   * interstitial. Guests have no receipt query, so their token lookup
   * is the authority once it resolves.
   */
  deferredStatusAuthoritative: boolean;
}

/**
 * Resolves who owns the deferred-settlement status (invoice, Pay for Me):
 * the authenticated receipt query for signed-in shoppers, the
 * tracking-token guest lookup only when there is no authenticated
 * customer. Both lookups begin unresolved so side effects wait.
 */
export function useDeferredOrderStatusAuthority({
  customer,
  needsDeferredStatus,
  orderId,
  paymentMethod,
  trackingToken,
}: DeferredOrderStatusAuthorityInput): DeferredOrderStatusAuthority {
  const { data: paidCheckOrder, isSuccess: isReceiptCheckSuccess } =
    useReceiptDetail(needsDeferredStatus ? (orderId ?? null) : null);
  const receiptPaymentStatus = paidCheckOrder?.payment_status;
  const receiptPaidOrder = receiptPaymentStatus === 'paid';
  const receiptAuthoritative =
    !needsDeferredStatus || !customer || isReceiptCheckSuccess;
  const guestInvoice = useGuestInvoicePaidState({
    orderId,
    paymentMethod,
    trackingToken,
    skip: receiptPaidOrder || !!customer,
  });
  return {
    guestInvoice,
    isPaidOrder: receiptPaidOrder || guestInvoice.status === 'paid',
    receiptAmountPaid: Number(paidCheckOrder?.amount_paid ?? 0),
    isCancelledOrder:
      isCancelledStatus(paidCheckOrder?.payment_status) ||
      isCancelledStatus(paidCheckOrder?.shipping_status) ||
      guestInvoice.status === 'cancelled',
    // Stored payment method from the authenticated receipt lookup (only
    // on a successful result): screens use it to confirm a
    // caller-controlled route method before selecting the document kind.
    receiptPaymentMethod: isReceiptCheckSuccess
      ? (paidCheckOrder?.payment_method ?? undefined)
      : undefined,
    receiptPaymentStatus,
    deferredStatusAuthoritative:
      receiptAuthoritative && guestInvoice.isResolved,
  };
}
