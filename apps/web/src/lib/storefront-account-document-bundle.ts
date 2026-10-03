import type { ReceiptMerchant, ReceiptOrder } from '@baci/shared';
import { buildAssuranceReceiptItem } from '@/lib/insurance-assurance-line';
import type { InvoiceData } from '@/lib/invoice-generator';
import { resolveInvoiceTypeCode } from '@/lib/resolve-invoice-type-code';
import { selectReceiptCompletionDate } from '@/lib/resolve-manual-document-receipt-date';
import type {
  StorefrontAccountDocumentCustomerRow,
  StorefrontAccountDocumentItemRow,
  StorefrontAccountDocumentMerchantRow,
  StorefrontAccountDocumentOrderRow,
  StorefrontAccountDocumentPaymentAccountRow,
  StorefrontAccountDocumentTaxSubtotalRow,
  StorefrontAccountDocumentTransactionRow,
} from '@/lib/storefront-account-document-bundle.types';
import { manualDocumentAvailabilityFlags } from '@/lib/storefront-account-document-eligibility';
import { buildInvoiceContent } from '@/lib/storefront-account-document-invoice-lines';
import {
  buildOrderProjection,
  isProviderConfirmedTransaction,
} from '@/lib/storefront-account-document-order-projection';
import {
  buildReceiptMerchant,
  buildReceiptOrder,
} from '@/lib/storefront-account-document-receipt';
import {
  asNumber,
  asRecord,
  asString,
  buildCustomerAddress,
  buildOrderItems,
  normalizeShippingAddress,
  resolveMoneyValue,
} from '@/lib/storefront-account-document-values';

interface BuildStorefrontAccountDocumentBundleInput {
  merchant: StorefrontAccountDocumentMerchantRow;
  customer: StorefrontAccountDocumentCustomerRow;
  order: StorefrontAccountDocumentOrderRow;
  itemRows: StorefrontAccountDocumentItemRow[];
  transactions: StorefrontAccountDocumentTransactionRow[];
  paymentAccount: StorefrontAccountDocumentPaymentAccountRow | null;
  taxRows: StorefrontAccountDocumentTaxSubtotalRow[];
  paymentStatus: string;
  shippingStatus: string;
  currentDocumentKind: 'invoice' | 'receipt';
  canCancel?: boolean;
}

export function buildStorefrontAccountDocumentBundle({
  merchant,
  customer,
  order,
  itemRows,
  transactions,
  paymentAccount,
  taxRows,
  paymentStatus,
  shippingStatus,
  currentDocumentKind,
  canCancel = false,
}: BuildStorefrontAccountDocumentBundleInput) {
  const currency = asString(order.currency) || 'NGN';
  const total = asNumber(order.total);
  const subtotal = asNumber(order.subtotal);
  // Payment-proof surfaces must never list attempts that moved no money:
  // filter once here so the receipt listing and the history card below
  // both inherit only genuine receipts.
  const confirmedTransactions = transactions.filter(
    isProviderConfirmedTransaction
  );
  const shippingFee = asNumber(order.shipping_fee);
  const taxAmount = asNumber(order.tax_amount);
  const discountAmount = asNumber(order.discount_amount);
  const amountPaid = asNumber(order.amount_paid);
  const balance = Math.max(0, total - amountPaid);
  const taxInclusiveAmount = resolveMoneyValue(
    order.tax_inclusive_amount,
    total
  );
  const preTaxTotal = Math.max(0, taxInclusiveAmount - taxAmount);
  const shippingAddress = normalizeShippingAddress(order.shipping_address);
  const orderItems = buildOrderItems(itemRows);
  const fallbackName = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  const customerName =
    asString(order.customer_name) || fallbackName || 'Customer';
  const customerEmail = asString(order.customer_email) || customer.email || '';
  const customerPhone =
    asString(order.customer_phone) || customer.phone || null;
  const receiptEligible = currentDocumentKind === 'receipt';
  // Manual availability for the invoice download gate: the sender refuses
  // invalid/cancelled manual rows, so the direct URL must not serve what
  // the sender and archive treat as unservable.
  const { isManualOrderRow, manualDocumentAvailable } =
    manualDocumentAvailabilityFlags({
      paymentStatus: order.payment_status,
      shippingStatus: order.shipping_status,
      externalSource: order.external_source,
      importJobId: order.import_job_id,
      recordedByUserId: order.recorded_by_user_id,
      total: order.total,
      amountPaid: order.amount_paid,
      money: order,
      items: itemRows,
    });
  // Same proforma rule as the order invoice route: the stored 380 default
  // must not win over 325 for unpaid invoice-method orders. Shared by the
  // generated invoiceData and the customer-facing order projection so the
  // account views label the same document the route downloads.
  const invoiceTypeCode = resolveInvoiceTypeCode({
    paymentMethod: order.payment_method,
    // A receipt-eligible order is settled in substance (paid flag or covered
    // manual balance), so its billing record resolves the commercial code.
    isPaid: paymentStatus === 'paid' || receiptEligible,
    wasPaid: paymentStatus === 'refunded',
    paymentStatus,
    amountPaid,
    storedTypeCode: order.invoice_type_code,
  });
  const registeredAddress = asRecord(merchant.registered_address);
  const {
    invoiceItems,
    taxSubtotals,
    documentTaxExclusive,
    documentTaxInclusive,
    assuranceTotal,
  } = buildInvoiceContent({
    order,
    merchant,
    orderItems,
    itemRows,
    taxRows,
    taxAmount,
    subtotal,
    shippingFee,
    discountAmount,
    preTaxTotal,
    taxInclusiveAmount,
  });

  const receiptMerchant: ReceiptMerchant = buildReceiptMerchant(
    merchant,
    currency
  );
  const receiptOrder: ReceiptOrder = buildReceiptOrder({
    order,
    orderItems,
    transactions: confirmedTransactions,
    paymentAccount,
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
  });

  if (assuranceTotal > 0) {
    receiptOrder.items.push(buildAssuranceReceiptItem(assuranceTotal));
  }

  const orderDetail = buildOrderProjection({
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
    virtualAccount: receiptOrder.virtual_account,
  });

  const invoiceData: InvoiceData = {
    invoice_number: order.order_number,
    invoice_type_code: invoiceTypeCode,
    issue_date: order.invoice_issue_date
      ? new Date(order.invoice_issue_date)
      : order.transaction_date
        ? new Date(order.transaction_date)
        : new Date(order.created_at),
    tax_point_date: order.tax_point_date
      ? new Date(order.tax_point_date)
      : undefined,
    due_date: order.payment_due_date
      ? new Date(order.payment_due_date)
      : undefined,
    currency,
    buyer_reference: order.buyer_reference || undefined,
    purchase_order_reference: order.purchase_order_reference || undefined,
    merchant: {
      business_name: merchant.business_name,
      legal_entity_name: merchant.legal_entity_name || undefined,
      tax_identification_number:
        merchant.tax_identification_number || undefined,
      cac_rc_number: merchant.cac_rc_number || undefined,
      vat_registration_status:
        merchant.vat_registration_status || 'unregistered',
      vat_rate: merchant.vat_rate ?? 0,
      registered_address: registeredAddress
        ? {
            street: asString(registeredAddress.street),
            city: asString(registeredAddress.city),
            state: asString(registeredAddress.state),
            postal_code: asString(registeredAddress.postal_code),
            country: asString(registeredAddress.country),
          }
        : undefined,
      support_email: merchant.support_email || undefined,
      support_phone: merchant.support_phone || undefined,
      logo_url: merchant.logo_url || undefined,
    },
    customer: {
      name: customerName,
      email: customerEmail || undefined,
      phone: customerPhone || undefined,
      address: buildCustomerAddress(shippingAddress),
    },
    items: invoiceItems,
    tax_subtotals: taxSubtotals,
    subtotal,
    tax_exclusive_amount: documentTaxExclusive,
    tax_amount: taxAmount,
    tax_inclusive_amount: documentTaxInclusive,
    shipping_fee: shippingFee,
    discount_amount: discountAmount,
    total,
    amount_paid: amountPaid,
    notes: order.invoice_note || order.notes || undefined,
    payment_terms: order.payment_terms || undefined,
    payment_account: paymentAccount
      ? {
          account_number: paymentAccount.account_number,
          account_name: paymentAccount.account_name || undefined,
          bank_name: paymentAccount.bank_name || undefined,
        }
      : merchant.bank_account_number
        ? {
            account_number: merchant.bank_account_number,
            account_name:
              merchant.bank_account_name ||
              merchant.legal_entity_name ||
              merchant.business_name ||
              undefined,
            bank_name: merchant.bank_name || undefined,
          }
        : undefined,
    firs_irn: order.firs_irn || undefined,
    firs_csid: order.firs_csid || undefined,
    firs_qr_code: order.firs_qr_code || undefined,
  };

  return {
    order: orderDetail,
    invoiceData,
    receiptOrder,
    receiptMerchant,
    // Canonical paid-receipt date shared with the emailed PDF: the newest
    // settled payment, so downloads agree with the attachment header.
    receiptCompletionDate: selectReceiptCompletionDate(transactions),
  };
}
