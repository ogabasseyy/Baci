import { resolveMerchantBankName, showMerchantBankDetails } from '@baci/shared';
import type { z } from 'zod';
import type { ManualOrderDocumentPaymentAccount } from '@/lib/build-manual-order-document-pdf-input';
import type {
  DispatchMerchantRow,
  DispatchPaymentSnapshot,
} from '@/lib/mark-manual-document-dispatch-started';
import type { manualDocumentMerchantSchema } from '@/schemas/manual-order-document-merchant';
import type { manualDocumentOrderSchema } from '@/schemas/manual-order-document-order';

type ManualDocumentMerchant = z.infer<typeof manualDocumentMerchantSchema>;
type ManualDocumentOrder = z.infer<typeof manualDocumentOrderSchema>;

export function buildDispatchPaymentSnapshot(
  merchant: ManualDocumentMerchant,
  preferredPaymentAccount: ManualOrderDocumentPaymentAccount | null,
  order: Pick<ManualDocumentOrder, 'currency' | 'total' | 'amount_paid'>,
  documentKind: 'invoice' | 'proforma_invoice' | 'receipt'
): DispatchPaymentSnapshot {
  // Mirror the jsPDF payment-section gate exactly: instructions render
  // only for invoices with an outstanding balance, only in NGN, and the
  // virtual account suppresses the merchant-bank fallback. The fallback
  // additionally requires an account number to render at all
  // (virtual_account || merchant.bank_account_number), so without one
  // every fallback field snapshots null — a lone bank-name edit while
  // the section is hidden must not mark an accepted invoice stale.
  // The bank NAME snapshots resolved (stored name, else the code-map
  // fallback): a code correction under a blank/placeholder name changes
  // the emailed card, while a code-only edit under a valid name must
  // not abort an identical render. The raw code stays reserved-null;
  // the RPC resolves its side with the mirrored SQL helper and compares
  // resolved-to-resolved.
  // Snapshotting hidden fields would resend an accepted, visually
  // unchanged invoice as a corrective duplicate; the dispatch RPC
  // compares the same rendered-only sides.
  const instructionsRendered =
    documentKind !== 'receipt' &&
    order.total - order.amount_paid > 0 &&
    showMerchantBankDetails(order.currency);
  const merchantBankRendered =
    instructionsRendered &&
    !preferredPaymentAccount &&
    Boolean(merchant.bank_account_number);
  return {
    merchantBankCode: null,
    merchantBankAccountNumber: merchantBankRendered
      ? merchant.bank_account_number
      : null,
    merchantBankName: merchantBankRendered
      ? resolveMerchantBankName(merchant.bank_name, merchant.bank_code)
      : null,
    merchantBankAccountName: merchantBankRendered
      ? merchant.bank_account_name
      : null,
    virtualAccountNumber: instructionsRendered
      ? (preferredPaymentAccount?.account_number ?? null)
      : null,
    virtualAccountBankName: instructionsRendered
      ? (preferredPaymentAccount?.bank_name ?? null)
      : null,
    virtualAccountName: instructionsRendered
      ? (preferredPaymentAccount?.account_name ?? null)
      : null,
  };
}

export function buildDispatchMerchantSnapshot(
  merchant: ManualDocumentMerchant,
  rawRegisteredAddress: unknown,
  rawBrandColors: unknown
): DispatchMerchantRow {
  // The merchant rides whole for transport, but staleness compares the
  // rendered-only subset: cac_rc_number prints nowhere and stays
  // ignored, the VAT inputs compare only for rowless taxed invoices
  // (breakdown synthesis), and registered_address gates invoices alone
  // (receipts print business_address instead).
  return {
    ...merchant,
    // Snapshot the RAW stored address: the schema normalizes malformed
    // scalars to null and strips legacy keys for rendering, but the RPC
    // compares against raw JSONB — snapshotting the normalized value
    // would report stale on every attempt for such merchants.
    registered_address: rawRegisteredAddress,
    // Same for brand colors: legacy shapes are normalized for the PDF,
    // but the RPC compares against the raw stored JSONB.
    brand_colors: rawBrandColors,
  };
}
