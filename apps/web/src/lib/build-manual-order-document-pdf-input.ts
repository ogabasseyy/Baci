import {
  type ReceiptMerchant,
  type ReceiptOrder,
  showMerchantBankDetails,
} from '@baci/shared';
import type { z } from 'zod';
import {
  buildAssuranceReceiptItem,
  sumAssuranceFees,
} from '@/lib/insurance-assurance-line';
import type { manualDocumentMerchantSchema } from '@/schemas/manual-order-document-merchant';
import type { manualDocumentOrderSchema } from '@/schemas/manual-order-document-order';

type ManualDocumentOrder = z.infer<typeof manualDocumentOrderSchema>;
type ManualDocumentMerchant = z.infer<typeof manualDocumentMerchantSchema>;

export interface ManualOrderDocumentPaymentAccount {
  account_number: string;
  bank_name: string | null;
  account_name: string | null;
}

/**
 * Shapes the parsed order/merchant rows into the receipt renderer's view
 * models. Naira bank details (persisted accounts and the order-level virtual
 * account the renderer prefers) are hidden on foreign-currency documents so
 * customers never wire dollars to a naira account.
 */
export function buildManualOrderDocumentPdfInput({
  order,
  merchant,
  recipientEmail,
  preferredPaymentAccount,
  transactions,
}: {
  order: ManualDocumentOrder;
  merchant: ManualDocumentMerchant;
  recipientEmail: string;
  preferredPaymentAccount: ManualOrderDocumentPaymentAccount | null;
  transactions?: ReceiptOrder['transactions'];
}): { receiptOrder: ReceiptOrder; receiptMerchant: ReceiptMerchant } {
  const showBankDetails = showMerchantBankDetails(order.currency || 'NGN');
  const receiptOrder: ReceiptOrder = {
    ...order,
    currency: order.currency || 'NGN',
    customer_name: order.customer_name || recipientEmail,
    customer_email: recipientEmail,
    amount_paid: order.amount_paid,
    balance: Math.max(0, order.total - order.amount_paid),
    transactions,
    virtual_account:
      showBankDetails && preferredPaymentAccount
        ? {
            account_number: preferredPaymentAccount.account_number,
            bank_name: preferredPaymentAccount.bank_name || '',
            account_name: preferredPaymentAccount.account_name || '',
          }
        : null,
    shipping_address: order.shipping_address
      ? {
          ...order.shipping_address,
          address_line1:
            order.shipping_address.address_line1 ||
            order.shipping_address.address,
          postal_code:
            order.shipping_address.postal_code ||
            order.shipping_address.postalCode,
        }
      : null,
    items: order.order_items.map((item) => ({
      ...item,
      product_name: item.name,
      description: item.item_description || undefined,
    })),
  };
  const assuranceTotal = sumAssuranceFees(order.order_items);
  if (assuranceTotal > 0) {
    receiptOrder.items.push(buildAssuranceReceiptItem(assuranceTotal));
  }
  const receiptMerchant = {
    ...merchant,
    brand_colors: merchant.brand_colors ?? undefined,
    bank_code: showBankDetails ? merchant.bank_code : null,
    bank_account_number: showBankDetails ? merchant.bank_account_number : null,
    bank_name: showBankDetails ? merchant.bank_name : null,
    bank_account_name: showBankDetails ? merchant.bank_account_name : null,
  };
  return { receiptOrder, receiptMerchant };
}
