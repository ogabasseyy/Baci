/**
 * Attribution candidates for an outflow webhook. For a wallet-to-wallet
 * transfer our own reference travels in the envelope
 * (pvb_third_party_reference) while eventData carries provider ids, so the
 * envelope value is added for wallet pay and savings attribution. The legacy
 * outbox keeps matching on eventData only.
 */
export function withEnvelopeReference(
  references: readonly string[],
  event: unknown
): string[] {
  const envelope =
    typeof event === 'object' && event !== null
      ? (event as { pvb_third_party_reference?: unknown })
          .pvb_third_party_reference
      : undefined;
  return typeof envelope === 'string' &&
    envelope.length > 0 &&
    !references.includes(envelope)
    ? [...references, envelope]
    : [...references];
}
