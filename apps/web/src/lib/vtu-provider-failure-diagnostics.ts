import type { PurchaseResult } from '@/lib/kuda';
import { readMonnifyResponseCode } from './monnify-response-code';

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
  // Re-checked here so only code-shaped values are ever stored, whatever
  // produced the result.
  const code = result.success
    ? undefined
    : readMonnifyResponseCode({ responseCode: result.providerResponseCode });
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
