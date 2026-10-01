export function isAmbiguousPaystackProvisioningFailure(
  outcome: unknown
): boolean {
  if (
    outcome &&
    typeof outcome === 'object' &&
    'success' in outcome &&
    outcome.success === false
  ) {
    const code =
      'code' in outcome && typeof outcome.code === 'string' ? outcome.code : '';
    if (!code) return false;
    if (code === 'NETWORK_ERROR') return true;
    const httpMatch = /^HTTP_(\d{3})$/.exec(code);
    if (!httpMatch) return false;
    const status = Number(httpMatch[1]);
    return status >= 500 || status === 408 || status === 429;
  }
  return true;
}
