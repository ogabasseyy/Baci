import type { PurchaseResult } from '@/lib/kuda';

/**
 * Keeps the provider's scrubbed error text and response code on a failed
 * row, and clears both from a successful one so stale diagnostics from an
 * earlier attempt never linger.
 */
export function applyProviderFailureDiagnostics(
  metadata: Record<string, unknown>,
  result: Pick<
    PurchaseResult,
    'providerErrorDetail' | 'providerResponseCode' | 'success'
  >
): void {
  const detail = result.success
    ? undefined
    : result.providerErrorDetail?.trim();
  const code = result.success ? undefined : result.providerResponseCode;
  if (detail) {
    metadata.providerErrorDetail = detail;
  } else {
    delete metadata.providerErrorDetail;
  }
  if (code) {
    metadata.providerResponseCode = code;
  } else {
    delete metadata.providerResponseCode;
  }
}
