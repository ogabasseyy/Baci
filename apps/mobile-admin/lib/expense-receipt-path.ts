const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECEIPT_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertOwnedExpenseReceiptPath(
  merchantId: string,
  storagePath: string
): void {
  const prefix = `${merchantId}/expenses/`;
  const fileName = storagePath.slice(prefix.length);

  if (
    !UUID_PATTERN.test(merchantId) ||
    !storagePath.startsWith(prefix) ||
    !RECEIPT_FILE_NAME_PATTERN.test(fileName)
  ) {
    throw new Error('Receipt path is not owned by the active merchant');
  }
}
