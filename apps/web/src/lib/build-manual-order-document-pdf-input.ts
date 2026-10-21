import {
  type ReceiptMerchant,
  type ReceiptOrder,
  resolveMerchantBankName,
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

// Legacy mobile-admin aliases (address, postalCode) collapse onto the
// canonical keys like the SQL canonicalizer, and nullish keys normalize
// to undefined-absent: every preview path builds through this so the
// modal matches the emailed PDF instead of hand-mirroring the aliases.
export function normalizeReceiptShippingAddress(
  address: unknown
): ReceiptOrder['shipping_address'] {
  if (address == null || typeof address !== 'object') return null;
  const record = address as {
    address?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    postalCode?: string | null;
    country?: string | null;
  };
  return {
    ...(address as Record<string, unknown>),
    city: record.city ?? undefined,
    state: record.state ?? undefined,
    address_line1: record.address_line1 || record.address || undefined,
    address_line2: record.address_line2 ?? undefined,
    country: record.country ?? undefined,
    postal_code: record.postal_code || record.postalCode || undefined,
  };
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
    shipping_address: normalizeReceiptShippingAddress(order.shipping_address),
    items: order.order_items.map((item) => ({
      ...item,
      product_name: item.name,
      description: item.item_description || undefined,
      // ReceiptOrder line ids/amounts are undefined-absent, never null.
      line_id: item.line_id ?? undefined,
      line_extension_amount: item.line_extension_amount ?? undefined,
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
    // The PDF generator renders bank_name only (never bank_code), so
    // resolve blank/placeholder names here like the HTML renderer does —
    // otherwise the attachment omits usable payment instructions.
    bank_name: showBankDetails
      ? resolveMerchantBankName(merchant.bank_name, merchant.bank_code)
      : null,
    bank_account_name: showBankDetails ? merchant.bank_account_name : null,
  };
  return { receiptOrder, receiptMerchant };
}
