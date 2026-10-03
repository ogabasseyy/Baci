import type { SupabaseClient } from '@supabase/supabase-js';
import { clearManualDocumentDispatchMarker } from '@/lib/check-manual-document-dispatch-lease';

interface DispatchOrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  variant_name: string | null;
  condition: string | null;
  item_description: string | null;
}

interface DispatchOrderSnapshot {
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
  notes?: string | null;
  transaction_date: string | null;
  invoice_issue_date: string | null;
  created_at: string;
  shipping_address: Record<string, unknown> | null;
  order_items: readonly DispatchOrderItem[];
}

interface DispatchOutboxRow {
  id: string;
  order_id: string;
  merchant_id: string;
  claim_owner: string;
  event_type: string;
}

export interface DispatchPaymentSnapshot {
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

/**
 * Atomically validates the rendered snapshot and marks dispatch start. A
 * check-then-mark in application code leaves a millisecond race between the
 * re-read and the marker; the RPC holds the order row while comparing, so a
 * payment, contact correction, or item edit landing mid-dispatch aborts
 * instead of sending a stale document. The snapshot covers every order-row
 * input the renderer reads (identity, money breakdown, notes, address,
 * dates, and item contents) plus the manual-order origin fields, not just
 * the count: a same-total money redistribution, address correction, or
 * eligibility change must abort too. The rendered payment instructions
 * (merchant bank fields plus the preferred virtual account) are covered
 * the same way so a bank-detail edit cannot silently misdirect a transfer,
 * but only for invoice and proforma kinds: receipts render no payment
 * instructions, so comparing them would spuriously abort every receipt for
 * an order with an assigned account. The rendered issuer identity (business
 * name, legal entity, addresses, support contacts, RC/TIN, VAT
 * registration) is compared for every kind instead since receipts print
 * the issuer header too. The
 * rendered VAT subtotals are covered too (count plus canonical rows) since
 * a same-total category correction would otherwise email a stale tax
 * breakdown, as is the rendered payment history: a payment inserted or
 * corrected mid-dispatch must abort rather than email a stale Payment
 * table. The claim-link host is covered too: a primary-domain deactivation
 * between the sender's resolve and the mark must abort rather than email a
 * CTA that no longer routes. The rendered kind is passed explicitly so the
 * RPC can snapshot exactly what is being sent. Callers must pass the exact
 * values the PDF was rendered from.
 */
export async function markManualDocumentDispatchStarted(
  supabase: SupabaseClient,
  row: DispatchOutboxRow,
  order: DispatchOrderSnapshot,
  documentKind: 'invoice' | 'proforma_invoice' | 'receipt',
  payment: DispatchPaymentSnapshot,
  taxSubtotals: readonly DispatchTaxSubtotal[],
  transactions: readonly DispatchTransaction[],
  merchant: DispatchMerchantIdentitySnapshot,
  claimDomain: string | null
): Promise<void> {
  const { data, error } = await supabase.rpc(
    'mark_manual_document_dispatch_started',
    {
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
      p_items: [...order.order_items]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          variant_name: item.variant_name,
          condition: item.condition,
          item_description: item.item_description,
        })),
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
        .map((txn) => ({
          amount: txn.amount,
          created_at: txn.created_at,
          description: txn.description,
          metadata: txn.metadata,
        })),
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
      p_order_created_at: order.created_at,
    }
  );
  if (error) throw new Error('Manual document dispatch state unavailable');
  if (data?.status === 'stale')
    throw new Error('Manual document order changed before dispatch');
  if (data?.status !== 'marked')
    throw new Error('Manual document dispatch lease lost');
}

export interface DispatchMerchantRow {
  business_name: string | null;
  legal_entity_name: string | null;
  business_address: string | null;
  registered_address: unknown;
  cac_rc_number: string | null;
  tax_identification_number: string | null;
  vat_registration_status: string | null;
  vat_rate: number | null;
  support_email: string | null;
  support_phone: string | null;
  phone: string | null;
  slug: string | null;
}

/**
 * Writes or clears the dispatch marker around transport. The atomic RPC
 * already committed dispatch_started_at, so clearing is a conditional
 * lease-holding write, not a second mark.
 */
export async function persistManualDocumentDispatch(
  supabase: SupabaseClient,
  row: DispatchOutboxRow,
  order: DispatchOrderSnapshot,
  documentKind: 'invoice' | 'proforma_invoice' | 'receipt',
  payment: DispatchPaymentSnapshot,
  taxSubtotals: readonly DispatchTaxSubtotal[],
  transactions: readonly DispatchTransaction[],
  merchant: DispatchMerchantRow,
  claimDomain: string | null,
  started: boolean
): Promise<void> {
  if (started) {
    await markManualDocumentDispatchStarted(
      supabase,
      row,
      order,
      documentKind,
      payment,
      taxSubtotals,
      transactions,
      {
        businessName: merchant.business_name,
        legalEntityName: merchant.legal_entity_name,
        businessAddress: merchant.business_address,
        registeredAddress: merchant.registered_address,
        cacRcNumber: merchant.cac_rc_number,
        taxIdentificationNumber: merchant.tax_identification_number,
        vatRegistrationStatus: merchant.vat_registration_status,
        vatRate: merchant.vat_rate,
        supportEmail: merchant.support_email,
        supportPhone: merchant.support_phone,
        phone: merchant.phone,
        slug: merchant.slug,
      },
      claimDomain
    );
    return;
  }
  await clearManualDocumentDispatchMarker(supabase, row);
}
