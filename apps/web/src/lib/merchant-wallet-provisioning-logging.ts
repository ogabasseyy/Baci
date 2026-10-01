export function logMerchantWalletProvisioningError(
  message: string,
  requestId: string,
  merchantId: string,
  error: unknown
) {
  console.error(message, {
    requestId,
    merchantId,
    error: error instanceof Error ? error.message : String(error),
  });
}
