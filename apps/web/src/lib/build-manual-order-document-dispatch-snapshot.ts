import { showMerchantBankDetails } from '@baci/shared';
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
  // virtual account suppresses the merchant-bank fallback. Snapshotting
  // hidden fields would let an unrelated bank edit mark an accepted,
  // visually unchanged invoice stale and resend it as a corrective
  // duplicate; the dispatch RPC compares the same rendered-only sides.
  const instructionsRendered =
    documentKind !== 'receipt' &&
    order.total - order.amount_paid > 0 &&
    showMerchantBankDetails(order.currency);
  const merchantBankRendered = instructionsRendered && !preferredPaymentAccount;
  return {
    merchantBankCode: merchantBankRendered ? merchant.bank_code : null,
    merchantBankAccountNumber: merchantBankRendered
      ? merchant.bank_account_number
      : null,
    merchantBankName: merchantBankRendered ? merchant.bank_name : null,
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
