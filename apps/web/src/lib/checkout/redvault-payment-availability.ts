export type RedvaultPaymentAvailability = {
  available: boolean;
  reason: 'provider_evidence_unavailable';
};

export function getRedvaultPaymentAvailability(): RedvaultPaymentAvailability {
  return { available: false, reason: 'provider_evidence_unavailable' };
}
