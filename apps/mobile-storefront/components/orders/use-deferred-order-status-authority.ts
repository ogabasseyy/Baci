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

export interface DeferredOrderStatusAuthority {
  guestInvoice: GuestInvoicePaymentState;
  isPaidOrder: boolean;
  receiptAmountPaid: number;
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
    receiptPaymentStatus,
    deferredStatusAuthoritative:
      receiptAuthoritative && guestInvoice.isResolved,
  };
}
