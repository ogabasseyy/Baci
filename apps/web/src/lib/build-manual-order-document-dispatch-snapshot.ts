import type { z } from 'zod';
import type { ManualOrderDocumentPaymentAccount } from '@/lib/build-manual-order-document-pdf-input';
import type {
  DispatchMerchantRow,
  DispatchPaymentSnapshot,
} from '@/lib/mark-manual-document-dispatch-started';
import type { manualDocumentMerchantSchema } from '@/schemas/manual-order-document-merchant';

type ManualDocumentMerchant = z.infer<typeof manualDocumentMerchantSchema>;

export function buildDispatchPaymentSnapshot(
  merchant: ManualDocumentMerchant,
  preferredPaymentAccount: ManualOrderDocumentPaymentAccount | null
): DispatchPaymentSnapshot {
  return {
    merchantBankCode: merchant.bank_code,
    merchantBankAccountNumber: merchant.bank_account_number,
    merchantBankName: merchant.bank_name,
    merchantBankAccountName: merchant.bank_account_name,
    virtualAccountNumber: preferredPaymentAccount?.account_number ?? null,
    virtualAccountBankName: preferredPaymentAccount?.bank_name ?? null,
    virtualAccountName: preferredPaymentAccount?.account_name ?? null,
  };
}

export function buildDispatchMerchantSnapshot(
  merchant: ManualDocumentMerchant,
  rawRegisteredAddress: unknown
): DispatchMerchantRow {
  return {
    ...merchant,
    // Snapshot the RAW stored address: the schema normalizes malformed
    // scalars to null and strips legacy keys for rendering, but the RPC
    // compares against raw JSONB — snapshotting the normalized value
    // would report stale on every attempt for such merchants.
    registered_address: rawRegisteredAddress,
  };
}
