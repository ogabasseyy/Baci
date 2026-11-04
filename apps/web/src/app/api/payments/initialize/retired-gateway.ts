/** Reject retired rails before lookup, transaction creation, or provider work. */
export function retiredGatewayResponse(
  gateway: string | undefined
): Response | null {
  return gateway === 'credpal'
    ? Response.json(
        { error: 'CredPal is unavailable', code: 'GATEWAY_RETIRED' },
        { status: 410 }
      )
    : null;
}
