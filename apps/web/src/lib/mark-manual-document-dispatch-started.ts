import type { SupabaseClient } from '@supabase/supabase-js';
import { clearManualDocumentDispatchMarker } from '@/lib/check-manual-document-dispatch-lease';

import type {
  DispatchMerchantIdentitySnapshot,
  DispatchOrderSnapshot,
  DispatchOutboxRow,
  DispatchPaymentSnapshot,
  DispatchTaxSubtotal,
  DispatchTransaction,
} from './manual-order-document-dispatch-params';
import { buildDispatchRpcParams } from './manual-order-document-dispatch-params';

export type {
  DispatchMerchantIdentitySnapshot,
  DispatchOrderSnapshot,
  DispatchOutboxRow,
  DispatchPaymentSnapshot,
  DispatchTaxSubtotal,
  DispatchTransaction,
} from './manual-order-document-dispatch-params';

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
    buildDispatchRpcParams({
      row,
      order,
      documentKind,
      payment,
      taxSubtotals,
      transactions,
      merchant,
      claimDomain,
    })
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
  email_sender_name: string | null;
  logo_url: string | null;
  brand_colors: unknown;
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
        emailSenderName: merchant.email_sender_name,
        logoUrl: merchant.logo_url,
        brandColors: merchant.brand_colors,
      },
      claimDomain
    );
    return;
  }
  await clearManualDocumentDispatchMarker(supabase, row);
}
