export function resolveChatwootCartProofExpiry(input: {
  cartExpiresAt: string;
  existingProofExpiresAt: string;
  liveGrantExpiresAt?: string;
}): string | null {
  const existingExpiry = Date.parse(input.existingProofExpiresAt);
  if (!Number.isFinite(existingExpiry)) return null;

  const cartExpiry = Date.parse(input.cartExpiresAt);
  if (!Number.isFinite(cartExpiry)) return null;

  const requestedGrantExpiry =
    input.liveGrantExpiresAt ?? input.existingProofExpiresAt;
  const requestedGrantMs = Date.parse(requestedGrantExpiry);
  const grantExpiresAt = Number.isFinite(requestedGrantMs)
    ? requestedGrantExpiry
    : input.existingProofExpiresAt;
  const grantExpiry = Number.isFinite(requestedGrantMs)
    ? requestedGrantMs
    : existingExpiry;
  return grantExpiry < cartExpiry ? grantExpiresAt : input.cartExpiresAt;
}
