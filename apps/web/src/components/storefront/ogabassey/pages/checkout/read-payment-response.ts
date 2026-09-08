/** Gateways and reverse proxies can return HTML on outages. Never expose it. */
export async function readPaymentResponse(
  response: Response
): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      'Payment service is temporarily unavailable. Please try again.'
    );
  }
  const payload = data as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Payment initialization failed. Please try again.'
    );
  }
  return payload;
}
