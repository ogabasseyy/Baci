/** Recheck admission at submission; the workflow RPC remains the authority. */
export async function checkOxygenStorefrontAvailability(merchantId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/payments/oxygen/storefront-availability?merchantId=${encodeURIComponent(merchantId)}`, {
      cache: 'no-store', signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return false;
    const result: unknown = await response.json();
    return typeof result === 'object' && result !== null && 'available' in result && result.available === true;
  } catch {
    return false;
  }
}
