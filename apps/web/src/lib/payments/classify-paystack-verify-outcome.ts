/**
 * Classify unsuccessful Paystack verification outcomes for the
 * abandoned-attempt sweep. Shared by the attempt processor: network,
 * auth, timeout, rate-limit, and 5xx codes are provider outages (the
 * row holds for a later sweep), while other 4xx codes are definitive
 * rejections of the stored reference (the row files and stamps).
 */
export function isVerificationUnavailable(code: string | undefined): boolean {
  if (code === 'NETWORK_ERROR' || code === 'CONFIG_ERROR') return true;
  const status = Number(/^HTTP_(\d{3})$/.exec(code ?? '')?.[1]);
  return (
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 429 ||
    status >= 500
  );
}

// Client errors other than auth/timeout/rate-limit/missing mean Paystack
// deterministically rejects this reference: it will never verify on
// retry, so review it instead of holding it as an outage forever. A 408
// is a transient provider timeout, not a verdict on the reference:
// retiring it would stamp a still-pending transaction out of future
// sweeps while cancellation keeps rejecting pending attempts.
export function isDefinitiveProviderRejection(
  code: string | undefined
): boolean {
  const status = Number(/^HTTP_(\d{3})$/.exec(code ?? '')?.[1]);
  return (
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 403 &&
    status !== 404 &&
    status !== 408 &&
    status !== 429
  );
}
