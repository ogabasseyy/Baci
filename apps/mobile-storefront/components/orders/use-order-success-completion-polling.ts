import { useInvoiceGeneratedCapture } from '@/components/checkout/use-invoice-generated-capture';
import { useSettlementCompletion } from './use-settlement-completion';

interface OrderSuccessCompletionPollingInput {
  customerEmail?: string | null;
  disabled: boolean;
  orderId?: string;
  orderNumber?: string;
  paymentMethod?: string;
  reference?: string;
  trackingToken?: string;
}

/**
 * Server-confirmation polling for the order-success screen. Both lanes
 * wait for the server instead of trusting the arrival: asynchronous
 * settlement (on-chain detection, bank transfers, late webhooks)
 * completes the funnel only once the order is paid, and
 * invoice_generated is captured only once the tracking lookup carries
 * the terminal artifact-delivery flag (never optimistically at
 * creation). Extracted from the order-success route (300-line limit).
 */
export function useOrderSuccessCompletionPolling({
  customerEmail,
  disabled,
  orderId,
  orderNumber,
  paymentMethod,
  reference,
  trackingToken,
}: OrderSuccessCompletionPollingInput): void {
  useSettlementCompletion({
    orderId,
    orderNumber,
    paymentMethod,
    reference,
    trackingToken,
    disabled,
  });
  useInvoiceGeneratedCapture({
    customerEmail: customerEmail ?? null,
    disabled,
    orderId,
    paymentMethod,
    trackingToken,
  });
}
