export function normalizeRetiredGateway(gateway: unknown): unknown {
  if (typeof gateway !== 'string') return gateway;
  const normalized = gateway.trim().toLowerCase();
  return normalized === 'klump' || normalized === 'credpal'
    ? normalized
    : gateway;
}

/** Reject retired rails before lookup, transaction creation, or provider work. */
export function retiredGatewayResponse(
  gateway: string | undefined
): Response | null {
  const normalized = normalizeRetiredGateway(gateway);
  if (normalized !== 'credpal' && normalized !== 'klump') return null;
  const provider = normalized === 'klump' ? 'Klump' : 'CredPal';
  return Response.json(
    { error: `${provider} is unavailable`, code: 'GATEWAY_RETIRED' },
    { status: 410 }
  );
}
