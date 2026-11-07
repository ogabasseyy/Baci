/** Reject retired rails before lookup, transaction creation, or provider work. */
export function retiredGatewayResponse(
  gateway: string | undefined
): Response | null {
  if (gateway !== 'credpal' && gateway !== 'klump') return null;
  const provider = gateway === 'klump' ? 'Klump' : 'CredPal';
  return Response.json(
    { error: `${provider} is unavailable`, code: 'GATEWAY_RETIRED' },
    { status: 410 }
  );
}
