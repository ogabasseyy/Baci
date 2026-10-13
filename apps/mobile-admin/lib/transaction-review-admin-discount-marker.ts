import { TRANSACTION_DISCOUNT_METADATA_KEY } from '@baci/shared/contracts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAdminEditedTransactionDiscount(adTracking: unknown) {
  if (!isRecord(adTracking)) {
    return false;
  }

  const metadata = adTracking[TRANSACTION_DISCOUNT_METADATA_KEY];
  return (
    isRecord(metadata) &&
    metadata.status === 'admin_edit' &&
    metadata.version === 4
  );
}
