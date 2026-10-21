import { canonicalizeTransactionPaymentMethod } from '@baci/shared';
import {
  type DispatchOrderItem,
  projectDispatchSnapshotItems,
} from './manual-order-document-dispatch-items';

export interface DispatchOrderSnapshot {
  customer_id: string | null;
  customer_email: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  recorded_by_user_id: string | null;
  import_job_id: string | null;
  external_source: string | null;
  total: number;
  subtotal: number;
  shipping_fee: number;
  tax_amount: number;
  discount_amount: number;
  amount_paid: number;
  currency?: string | null;
  order_number: string;
  payment_status: string;
  payment_method: string | null;
  shipping_status: string;
  invoice_type_code: string | null;
  invoice_note?: string | null;
  payment_due_date?: string | null;
  payment_terms?: string | null;
  buyer_reference?: string | null;
  firs_irn?: string | null;
  firs_csid?: string | null;
  notes?: string | null;
  transaction_date: string | null;
  invoice_issue_date: string | null;
  created_at: string;
  shipping_address: Record<string, unknown> | null;
  order_items: readonly DispatchOrderItem[];
}

export interface DispatchOutboxRow {
  id: string;
  order_id: string;
  merchant_id: string;
  claim_owner: string;
  event_type: string;
}

export interface DispatchPaymentSnapshot {
  // Reserved null: the raw code rides inside the RESOLVED bank name
  // (stored name, else the code-map fallback), so the snapshot omits it
  // and the RPC ignores the positional parameter (kept for signature
  // stability across the SQL call sites).
  merchantBankCode: string | null;
  merchantBankAccountNumber: string | null;
  merchantBankName: string | null;
  merchantBankAccountName: string | null;
  virtualAccountNumber: string | null;
  virtualAccountBankName: string | null;
  virtualAccountName: string | null;
}

export interface DispatchMerchantIdentitySnapshot {
  businessName: string | null;
  legalEntityName: string | null;
  businessAddress: string | null;
  registeredAddress: unknown;
  cacRcNumber: string | null;
  taxIdentificationNumber: string | null;
  vatRegistrationStatus: string | null;
  vatRate: number | null;
  supportEmail: string | null;
  supportPhone: string | null;
  phone: string | null;
  slug: string | null;
  emailSenderName: string | null;
  logoUrl: string | null;
  brandColors: unknown;
}

export interface DispatchTaxSubtotal {
  id: string;
  vat_category_code: string;
  vat_rate: number;
  taxable_amount: number;
  tax_amount: number;
  exemption_reason: string | null;
}

export interface DispatchTransaction {
  id: string;
  amount: number | null;
  created_at: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
}

export interface DispatchRpcParamsInput {
  row: DispatchOutboxRow;
  order: DispatchOrderSnapshot;
  documentKind: 'invoice' | 'proforma_invoice' | 'receipt';
  payment: DispatchPaymentSnapshot;
  taxSubtotals: readonly DispatchTaxSubtotal[];
  transactions: readonly DispatchTransaction[];
  merchant: DispatchMerchantIdentitySnapshot;
  claimDomain: string | null;
}

// Builds the atomic-RPC snapshot params from the exact values the PDF was
// rendered from. Extracted so the marker module stays under the file limit.
export function buildDispatchRpcParams(input: DispatchRpcParamsInput) {
  const {
    row,
    order,
    documentKind,
    payment,
    taxSubtotals,
    transactions,
    merchant,
    claimDomain,
  } = input;
  return {
    p_outbox_id: row.id,
    p_claim_owner: row.claim_owner,
    p_customer_id: order.customer_id,
    p_customer_email: order.customer_email,
    p_customer_name: order.customer_name,
    p_customer_phone: order.customer_phone,
    p_recorded_by_user_id: order.recorded_by_user_id,
    p_import_job_id: order.import_job_id,
    p_external_source: order.external_source,
    p_document_kind: documentKind,
    p_total: order.total,
    p_subtotal: order.subtotal,
    p_shipping_fee: order.shipping_fee,
    p_tax_amount: order.tax_amount,
    p_discount_amount: order.discount_amount,
    p_amount_paid: order.amount_paid,
    p_currency: order.currency ?? null,
    p_order_number: order.order_number,
    p_payment_status: order.payment_status,
    p_payment_method: order.payment_method,
    p_shipping_status: order.shipping_status,
    p_invoice_type_code: order.invoice_type_code,
    p_invoice_note: order.invoice_note ?? null,
    p_payment_due_date: order.payment_due_date ?? null,
    p_payment_terms: order.payment_terms ?? null,
    p_buyer_reference: order.buyer_reference ?? null,
    p_firs_irn: order.firs_irn ?? null,
    p_firs_csid: order.firs_csid ?? null,
    p_notes: order.notes ?? null,
    p_transaction_date: order.transaction_date,
    p_invoice_issue_date: order.invoice_issue_date,
    p_shipping_address: order.shipping_address,
    p_item_count: order.order_items.length,
    p_merchant_bank_code: payment.merchantBankCode,
    p_merchant_bank_account_number: payment.merchantBankAccountNumber,
    p_merchant_bank_name: payment.merchantBankName,
    p_merchant_bank_account_name: payment.merchantBankAccountName,
    p_va_account_number: payment.virtualAccountNumber,
    p_va_bank_name: payment.virtualAccountBankName,
    p_va_account_name: payment.virtualAccountName,
    p_items: projectDispatchSnapshotItems(order.order_items),
    p_tax_count: taxSubtotals.length,
    p_tax_subtotals: [...taxSubtotals]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((tax) => ({
        vat_category_code: tax.vat_category_code,
        vat_rate: tax.vat_rate,
        taxable_amount: tax.taxable_amount,
        tax_amount: tax.tax_amount,
        exemption_reason: tax.exemption_reason,
      })),
    p_txn_count: transactions.length,
    p_transactions: [...transactions]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((txn) => {
        // Narrowed to the rendered key like the server snapshot (->>
        // parity): webhook enrichments must not stale the comparison.
        // Structured methods canonicalize to absent like SQL, never
        // String() to '[object Object]' and stale every attempt.
        const paymentMethod = txn.metadata?.payment_method;
        return {
          amount: txn.amount,
          created_at: txn.created_at,
          description: txn.description,
          metadata: {
            payment_method: canonicalizeTransactionPaymentMethod(paymentMethod),
          },
        };
      }),
    p_merchant_business_name: merchant.businessName,
    p_merchant_legal_entity_name: merchant.legalEntityName,
    p_merchant_business_address: merchant.businessAddress,
    p_merchant_registered_address: merchant.registeredAddress,
    p_merchant_cac_rc_number: merchant.cacRcNumber,
    p_merchant_tax_identification_number: merchant.taxIdentificationNumber,
    p_merchant_vat_registration_status: merchant.vatRegistrationStatus,
    p_merchant_vat_rate: merchant.vatRate,
    p_claim_domain: claimDomain,
    p_merchant_support_email: merchant.supportEmail,
    p_merchant_support_phone: merchant.supportPhone,
    p_merchant_phone: merchant.phone,
    p_merchant_slug: merchant.slug,
    p_merchant_email_sender_name: merchant.emailSenderName,
    p_merchant_logo_url: merchant.logoUrl,
    p_merchant_brand_colors: merchant.brandColors,
    p_order_created_at: order.created_at,
  };
}
