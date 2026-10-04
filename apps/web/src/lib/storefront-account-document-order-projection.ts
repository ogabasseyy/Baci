import type { ReceiptOrder } from '@baci/shared';
import type {
  StorefrontAccountDocumentMerchantRow,
  StorefrontAccountDocumentOrderRow,
  StorefrontAccountDocumentTransactionRow,
} from '@/lib/storefront-account-document-bundle.types';
import {
  asNumber,
  type normalizeShippingAddress,
} from '@/lib/storefront-account-document-values';
import type {
  StorefrontOrder,
  StorefrontOrderItem,
} from '@/types/storefront-order';

// Payment-type rows with provider-confirmed statuses represent genuine
// value movement. Only these belong in customer payment surfaces
// (history card, receipt listing): pending/processing attempts never
// moved money, failed/cancelled ones never will, and non-payment types
// (a completed refund row) would render as a positive Payment entry —
// the sender and orders-list preview both require transaction_type ===
// 'payment', so the archive must too. Paystack-backed payments settle
// as 'success' (the sender's history query includes it), so the archive
// must too or downloads omit payments the emailed PDF shows. A refunded
// payment row is still genuine history — the order-level status already
// shows the reversal.
const PROVIDER_CONFIRMED_TRANSACTION_STATUSES = [
  'completed',
  'refunded',
  'success',
];

export function isProviderConfirmedTransaction(row: {
  status?: string | null;
  transaction_type?: string | null;
}): boolean {
  return (
    row.transaction_type === 'payment' &&
    typeof row.status === 'string' &&
    PROVIDER_CONFIRMED_TRANSACTION_STATUSES.includes(
      row.status.trim().toLowerCase()
    )
  );
}

export interface BuildOrderProjectionInput {
  order: StorefrontAccountDocumentOrderRow;
  merchant: Pick<
    StorefrontAccountDocumentMerchantRow,
    'support_email' | 'support_phone' | 'rider_phone_number'
  >;
  orderItems: StorefrontOrderItem[];
  shippingStatus: string;
  paymentStatus: string;
  shippingAddress: ReturnType<typeof normalizeShippingAddress>;
  currency: string;
  total: number;
  subtotal: number;
  shippingFee: number;
  taxAmount: number;
  discountAmount: number;
  amountPaid: number;
  balance: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  invoiceTypeCode: string;
  receiptEligible: boolean;
  isManualOrderRow: boolean;
  manualDocumentAvailable: boolean;
  canCancel: boolean;
  currentDocumentKind: 'invoice' | 'receipt';
  confirmedTransactions: StorefrontAccountDocumentTransactionRow[];
  virtualAccount: ReceiptOrder['virtual_account'];
}

export function buildOrderProjection({
  order,
  merchant,
  orderItems,
  shippingStatus,
  paymentStatus,
  shippingAddress,
  currency,
  total,
  subtotal,
  shippingFee,
  taxAmount,
  discountAmount,
  amountPaid,
  balance,
  customerName,
  customerEmail,
  customerPhone,
  invoiceTypeCode,
  receiptEligible,
  isManualOrderRow,
  manualDocumentAvailable,
  canCancel,
  currentDocumentKind,
  confirmedTransactions,
  virtualAccount,
}: BuildOrderProjectionInput): StorefrontOrder {
  const orderDetail: StorefrontOrder = {
    id: order.id,
    order_number: order.order_number,
    created_at: order.created_at,
    updated_at: order.updated_at || undefined,
    shipping_status: shippingStatus,
    payment_status: paymentStatus,
    tracking_number: order.tracking_number || undefined,
    subtotal,
    total,
    shipping_fee: shippingFee,
    shipping_cost: shippingFee,
    shipping_provider: order.shipping_provider || undefined,
    shipping_rate_id: order.shipping_rate_id || undefined,
    shipping_rate_name: order.shipping_rate_name || undefined,
    shipping_pickup_details: order.shipping_pickup_details ?? null,
    shipping_address: shippingAddress,
    payment_method: order.payment_method || undefined,
    payment_provider: order.payment_method || undefined,
    paymentMethod: order.payment_method || undefined,
    items: orderItems,
    currency,
    amount_paid: amountPaid,
    tax_amount: taxAmount,
    discount_amount: discountAmount,
    balance,
    current_document_kind: currentDocumentKind,
    invoice_type_code: invoiceTypeCode,
    receipt_eligible: receiptEligible,
    is_manual_order: isManualOrderRow,
    manual_document_available: manualDocumentAvailable,
    can_cancel: canCancel,
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone,
    merchant_support_email: merchant.support_email || null,
    merchant_support_phone: merchant.support_phone || null,
    rider_phone_number: merchant.rider_phone_number || null,
    notes: order.notes || null,
    transactions: confirmedTransactions.map((transaction) => ({
      id: transaction.id || undefined,
      amount: asNumber(transaction.amount),
      created_at: transaction.created_at,
      description: transaction.description,
      metadata: transaction.metadata,
    })),
    virtual_account: virtualAccount || null,
  };

  return orderDetail;
}
